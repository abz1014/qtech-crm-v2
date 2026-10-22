import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test'
import { db, SERVICE_KEY, USER } from '../../verify/support/db'
import { company, karachiDay, order, post, postMany, quote, ref, rfq, supplier } from '../../verify/support/fixtures'
import { blankCtx, ctxAs, layout, note, probe, probe as huntProbe, settle, shot, tag, visit, watch, type Viewport } from './support'
import type { Role } from '../../support/stack'

/*
 * Cross-cutting daily use (hunt round 1). Everything is recorded with probe()/note(), nothing stops at the first failure.
 * Desktop is 1366x768, phone is 375x812 with touch. What is probed:
 *
 *   today        per role and size: the "N need you" header, the rows on the list and the nav badges (Today = RFQs + Orders + Money)
 *                agree; a customer chase (copy and mark chased) stamps once, Undo puts the count back and the row stays; after the
 *                Undo window the row moves to Waiting and every count drops by one; Snooze hides the row, Undo brings it back (DB).
 *   palette      Ctrl+K / Search button; company, partial words, contact, RFQ-0001 style refs, bare numbers, ORD refs, the customer PO,
 *                the customer reference, Urdu, % _ ' ( [ \ and SQL-ish text, emoji, 300 characters: an answer, no error, no 4xx/5xx;
 *                a literal % or _ must not act as a wildcard; a name with a backslash must be found.
 *   shortcuts    N, C, G then T, ?, / must not fire while typing in a list filter, the palette, a dialog's text box; C with a menu open;
 *                C/N with single-key shortcuts turned off; keys while the non-modal Help side panel is open; Esc; Ctrl+K over a dialog.
 *   help         ?help= on every main screen and detail page: the panel opens, "For this screen" recipes open and are real, an unknown
 *                recipe says so, search answers, Close removes ?help=; every "How Q-Tech CRM works" card's Show me opens a real recipe.
 *   lists        ~60 open + 30 closed RFQs for one customer: Showing count, sticky header while #main scrolls, scroll place and search
 *                kept on Back, sort kept on Back and refresh, URL kept on refresh, closed pagination (Next, refresh, page=999), the lede
 *                counts with Mine vs All; Orders: search, sort, a Filters choice kept in the URL on refresh, junk params; phone layout.
 *   companies    new company; a duplicate typed with doubled inner spaces or a trailing no-break space; merge moves the RFQ and the
 *                contact and removes the duplicate; is there a delete; two tabs: an edit from a stale tab silently undoing the other's.
 *   offline      context.setOffline on: new company, add RFQ item, supplier reply save, Delivered today, a Today chase: a plain message,
 *                the input kept, the offline banner shows and clears, and Try again saves exactly one row (DB count).
 *   navigation   Back/Forward across list -> detail -> dialog (typed text, filters), refresh on detail pages and inside ?new=1 and
 *                ?help= dialogs; a deep link while signed out comes back after sign in; sign out in one tab while another is open.
 *   long names   a 120-character company and a long contact name on Today, the board, the RFQ, Orders, the order, the company and the
 *                palette at phone size: layout() for cut-off and overlapping text.
 *
 * Every page is watch()ed (console errors, 4xx/5xx, failed requests) and visit() records screens slower than 2 s.
 */

const T = tag(6)
const TU = T.toUpperCase()
const ts = (days: number) => `${karachiDay(days)}T09:00:00+05:00`
const NETWORK = /Check your connection|connection|offline|signal/i

async function newPage(ctx: BrowserContext, info: TestInfo, label: string): Promise<Page> {
  const page = await ctx.newPage()
  // A missing element fails its probe in seconds instead of waiting for the 10-minute test timeout.
  page.setDefaultTimeout(12_000)
  watch(page, info, label)
  return page
}

const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
const mainText = (page: Page) => page.locator('#main').innerText().catch(() => '')

/** A customer chase that is due: an open RFQ owned by `owner`, one question asked 9 days ago, no answer. */
async function seedChase(owner: keyof typeof USER, label: string) {
  const co = await company(`Hunt ${label} ${T}`)
  const r = await post<{ id: string; number: number }>('rfqs', { company_id: co.id, owner_id: USER[owner], due_on: karachiDay(14) })
  await post('rfq_items', { rfq_id: r.id, position: 0, description: `Hunt chase gauge ${tag()}`, qty: 2 })
  const qs = await postMany<{ id: string }>('clarifications', [
    { rfq_id: r.id, question: 'Line size and flange rating on the process line', first_asked_at: ts(-9), last_asked_at: ts(-9), ask_count: 1 },
  ])
  return { co, rfq: r, ref: ref.rfq(r.number), clar: qs[0].id }
}

const askCount = async (id: string) => (await db.one<{ ask_count: number }>(`clarifications?id=eq.${id}&select=ask_count`)).ask_count

/** Poll a value until `ok` or the timeout; returns the last value. */
async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
  const end = Date.now() + ms
  let v = await read()
  while (!ok(v) && Date.now() < end) {
    await new Promise(r => setTimeout(r, 300))
    v = await read()
  }
  return v
}

/** The numbers the screen shows: Today's header, active rows, and each nav badge (parsed from the ", N need you" words). */
async function todayNumbers(page: Page) {
  const text = await mainText(page)
  const m = /(\d+)\s+need you/.exec(text)
  const header = m ? Number(m[1]) : null
  const rows = await page.locator('#main li[data-rule]:not([data-waiting])').count()
  const links = await page
    .getByRole('navigation', { name: 'Main' })
    .filter({ visible: true })
    .first()
    .getByRole('link')
    .evaluateAll(as => as.map(a => (a.textContent ?? '').replace(/\s+/g, ' ').trim()))
  const nav: Record<string, number> = {}
  for (const l of links) {
    const n = /, (\d+) need you/.exec(l)
    const key = /^(\d*)\s*(Today|RFQs|Orders|Money|Companies|Reports)/.exec(l)?.[2]
    if (key) nav[key] = n ? Number(n[1]) : 0
  }
  return { header, rows, nav }
}

async function checkParity(page: Page, info: TestInfo, where: string) {
  const n = await todayNumbers(page)
  const sections = (n.nav.RFQs ?? 0) + (n.nav.Orders ?? 0) + (n.nav.Money ?? 0)
  if (n.header !== null && n.header !== n.rows) note(info, { kind: 'observation', where, what: `Today header says ${n.header} need you but the list has ${n.rows} active rows`, detail: n })
  if (n.header !== null && n.nav.Today !== undefined && n.nav.Today !== n.header) note(info, { kind: 'observation', where, what: `Today nav badge ${n.nav.Today} differs from the header ${n.header}`, detail: n })
  if (n.nav.Today !== undefined && sections !== n.nav.Today) note(info, { kind: 'observation', where, what: `nav badges RFQs+Orders+Money = ${sections}, Today badge = ${n.nav.Today}`, detail: n })
  return n
}

/** The control row for an item: on desktop the context pane, on a phone the accordion inside the row. */
async function openItem(page: Page, vp: Viewport, rule: string, refText: string): Promise<Locator> {
  const row = page.locator(`#main li[data-rule="${rule}"]`).filter({ hasText: refText }).first()
  await row.waitFor({ timeout: 15_000 })
  const head = row.getByRole('button').first()
  // On a phone the row is an accordion: a second tap would close what an earlier step left open.
  if (vp !== 'phone' || (await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  if (vp === 'phone') return row
  const pane = page.getByRole('region', { name: new RegExp(`${refText}$`) }).last()
  await pane.waitFor({ timeout: 10_000 })
  return pane
}

async function snoozeAndUndo(page: Page, info: TestInfo, vp: Viewport, rule: string, refText: string, where: string) {
  const scope = await openItem(page, vp, rule, refText)
  await scope.getByRole('button', { name: 'Snooze', exact: true }).first().click()
  await page.getByRole('menuitem', { name: /Tomorrow morning/ }).click()
  const rows = page.locator(`#main li[data-rule="${rule}"]`).filter({ hasText: refText })
  const gone = await until(() => rows.count(), c => c === 0)
  if (gone !== 0) note(info, { kind: 'observation', where, what: `snoozed ${rule} ${refText} is still on the list` })
  const undo = page.getByRole('status').filter({ hasText: /Snoozed until/ }).getByRole('button', { name: /^Undo/ }).first()
  await undo.click({ timeout: 10_000 })
  const back = await until(() => rows.count(), c => c > 0, 12_000)
  if (back === 0) note(info, { kind: 'observation', where, what: `Undo of a snooze did not bring ${rule} ${refText} back to Today` })
}

// ================================================================================================ Today

for (const vp of ['desktop', 'phone'] as Viewport[])
  test(`crosscut: Today counts, chase and snooze with Undo, every role at ${vp}`, async ({ browser }, info) => {
    const salesA = await seedChase('sales', `Today Chase ${vp}`)
    const salesB = await seedChase('sales', `Today Snooze ${vp}`)
    const adminA = await seedChase('admin', `Today Admin ${vp}`)
    // An engineer's job: goods delivered to site, commissioning not dated yet (job_on_site), on an order owned by sales.
    const jobCo = await company(`Hunt Job ${vp} ${T}`)
    const jobSup = await supplier(`Hunt Job Supplier ${vp} ${T}`, 'Pakistan')
    const job = await order({ customer: jobCo, suppliers: [{ supplier: jobSup }], lines: [{ description: `Hunt control valve ${tag()}`, qty: 1, price: 1000, leg: 0 }], owner: 'sales', needsCommissioning: true })
    await db.patch(`supplier_orders?id=eq.${job.legs[0].id}`, { placed_on: karachiDay(-15), expected_on: karachiDay(-5), delivered_on: karachiDay(-2) })
    await post('order_engineers', { order_id: job.order.id, user_id: USER.engineer }).catch(e => note(info, { kind: 'probe-failed', where: 'seed order_engineers', what: String(e).slice(0, 300) }))
    const jobRef = ref.order(job.order.number)

    for (const role of ['sales', 'admin', 'engineer'] as Role[]) {
      const ctx = await ctxAs(browser, info, role, vp)
      const page = await newPage(ctx, info, `today/${role}/${vp}`)
      const where = `today ${role}/${vp}`
      await probe(info, page, `${where} load and counts`, async () => {
        await visit(page, info, '/today', where)
        await checkParity(page, info, where)
        await layout(page, info, where)
        await shot(page, `today-${role}-${vp}`)
      })

      if (role === 'sales') {
        let before: Awaited<ReturnType<typeof todayNumbers>> = { header: null, rows: 0, nav: {} }
        await probe(info, page, `${where} chase then Undo`, async () => {
          before = await todayNumbers(page)
          const scope = await openItem(page, vp, 'chase_customer', salesA.ref)
          if (vp === 'phone') await layout(page, info, `${where} accordion open`)
          await scope.getByRole('button', { name: /^Copy (message )?and mark chased$/ }).first().click()
          const after = await until(() => askCount(salesA.clar), c => c === 2)
          if (after !== 2) note(info, { kind: 'observation', where, what: `one chase tap left ask_count at ${after} (expected 2)` })
          await page.getByRole('status').filter({ hasText: /marked chased/ }).getByRole('button', { name: /^Undo/ }).first().click({ timeout: 8_000 })
          const undone = await until(() => askCount(salesA.clar), c => c === 1)
          if (undone !== 1) note(info, { kind: 'observation', where, what: `Undo of a chase left ask_count at ${undone} (expected 1)` })
          await page.waitForTimeout(800)
          const still = await page.locator('#main li[data-rule="chase_customer"]:not([data-waiting])').filter({ hasText: salesA.ref }).count()
          if (still === 0) note(info, { kind: 'observation', where, what: 'after Undo the chased item is not back on the active list' })
          await checkParity(page, info, `${where} after undo`)
        })
        await probe(info, page, `${where} chase, let the Undo window close, item moves to Waiting`, async () => {
          const scope = await openItem(page, vp, 'chase_customer', salesA.ref)
          await scope.getByRole('button', { name: /^Copy (message )?and mark chased$/ }).first().click()
          await until(() => askCount(salesA.clar), c => c === 2)
          await page.waitForTimeout(12_000)
          await settle(page)
          const active = await page.locator('#main li[data-rule="chase_customer"]:not([data-waiting])').filter({ hasText: salesA.ref }).count()
          if (active > 0) note(info, { kind: 'observation', where, what: 'chased item is still in the active list 12 s after the chase (expected Waiting)' })
          const n = await checkParity(page, info, `${where} after chase settled`)
          if (before.header !== null && n.header !== null && n.header !== before.header - 1)
            note(info, { kind: 'observation', where, what: `need-you count went ${before.header} -> ${n.header} after one chase (expected -1)` })
          if (before.nav.Today !== undefined && n.nav.Today !== undefined && n.nav.Today !== before.nav.Today - 1)
            note(info, { kind: 'observation', where, what: `Today nav badge went ${before.nav.Today} -> ${n.nav.Today} after one chase (expected -1)` })
          await shot(page, `today-${role}-${vp}-after-chase`)
        })
        await probe(info, page, `${where} snooze then Undo`, () => snoozeAndUndo(page, info, vp, 'chase_customer', salesB.ref, where))
      }
      if (role === 'admin')
        await probe(info, page, `${where} admin chase then Undo`, async () => {
          const scope = await openItem(page, vp, 'chase_customer', adminA.ref)
          await scope.getByRole('button', { name: /^Copy (message )?and mark chased$/ }).first().click()
          if ((await until(() => askCount(adminA.clar), c => c === 2)) !== 2) note(info, { kind: 'observation', where, what: 'admin chase tap did not stamp ask_count 2' })
          await page.getByRole('status').filter({ hasText: /marked chased/ }).getByRole('button', { name: /^Undo/ }).first().click({ timeout: 8_000 })
          if ((await until(() => askCount(adminA.clar), c => c === 1)) !== 1) note(info, { kind: 'observation', where, what: 'admin Undo did not restore ask_count 1' })
        })
      if (role === 'engineer')
        await probe(info, page, `${where} engineer job snooze then Undo`, async () => {
          const rows = await page.locator('#main li[data-rule]').filter({ hasText: jobRef }).count()
          if (rows === 0) {
            note(info, { kind: 'observation', where, what: `engineer assigned to ${jobRef} (goods on site, commissioning undated) sees no Today item for it` })
            return
          }
          const rule = (await page.locator('#main li[data-rule]').filter({ hasText: jobRef }).first().getAttribute('data-rule')) ?? 'job_on_site'
          await snoozeAndUndo(page, info, vp, rule, jobRef, where)
        })
      await ctx.close()
    }
  })

// ================================================================================================ palette and shortcuts

async function openPalette(page: Page): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: 'Search or jump to' })
  for (let i = 0; i < 8 && !(await dialog.isVisible()); i++) {
    await page.keyboard.press('Control+k')
    await dialog.waitFor({ timeout: 1200 }).catch(() => undefined)
    if (!(await dialog.isVisible())) {
      const btn = page.getByRole('button', { name: /^(Search or jump to|Search)$/ }).filter({ visible: true }).first()
      if (await btn.count()) await btn.click().catch(() => undefined)
      await dialog.waitFor({ timeout: 1200 }).catch(() => undefined)
    }
  }
  await dialog.waitFor({ timeout: 2000 })
  return dialog
}

/** Types `q` into the palette and returns the option texts once the search answered (or 4 s passed). */
async function paletteAsk(page: Page, dialog: Locator, q: string): Promise<{ options: string[]; status: number | null; ms: number }> {
  const t0 = Date.now()
  const answer = page.waitForResponse(r => r.url().includes('/rpc/search_all'), { timeout: 4_000 }).catch(() => null)
  await dialog.getByRole('combobox').fill(q)
  const res = q.trim() ? await answer : null
  await page.waitForTimeout(350)
  const options = (await dialog.getByRole('option').allInnerTexts()).map(s => s.replace(/\s+/g, ' ').trim())
  return { options, status: res ? res.status() : null, ms: Date.now() - t0 }
}

test('crosscut: palette search with refs, partial words, Urdu, wildcard and SQL-ish text', async ({ browser }, info) => {
  const co = await post<{ id: string; name: string }>('companies', { name: `Hunt Srch ${T} Textiles` })
  await post('contacts', { company_id: co.id, name: `Zubair${T} Qureshi`, phone: '+92 300 555 1212', email: `zubair.${T}@hunt.example` })
  const r = await rfq({ customer: co, items: [{ description: `Hunt srch flowmeter ${T}`, qty: 1 }], extra: { customer_ref: `ENQ-${TU}-9` } })
  const o = await order({ customer: co, lines: [{ description: `Hunt srch item ${T} pressure switch`, qty: 1, price: 1000 }], customerPo: `HPO-${TU}`, owner: 'sales' })
  const urdu = await post<{ id: string; name: string }>('companies', { name: `حسن انڈسٹریز ${T}` })
  const slash = await post<{ id: string; name: string }>('companies', { name: `Hunt Back\\slash ${T}` })
  const pct = await post<{ id: string; name: string }>('companies', { name: `Hunt 100% Pure ${T}` })
  const und = await post<{ id: string; name: string }>('companies', { name: `Hunt Under_score ${T}` })

  const cases: { q: string; want?: string | RegExp; why: string }[] = [
    { q: `srch ${T}`, want: co.name, why: 'partial words of a company' },
    { q: `${T} textiles`, want: co.name, why: 'company words out of the start' },
    { q: `zubair${T}`, want: `Zubair${T} Qureshi`, why: 'contact name' },
    { q: `0300 555 1212`, want: `Zubair${T} Qureshi`, why: 'contact phone written with 0' },
    { q: ref.rfq(r.rfq.number), want: ref.rfq(r.rfq.number), why: 'RFQ-0001 style ref' },
    { q: String(r.rfq.number), want: ref.rfq(r.rfq.number), why: 'bare RFQ number' },
    { q: `rfq ${r.rfq.number}`, want: ref.rfq(r.rfq.number), why: '"rfq 12" with a space' },
    { q: `rfq-${String(r.rfq.number).padStart(6, '0')}`, want: ref.rfq(r.rfq.number), why: 'RFQ ref with extra leading zeros' },
    { q: ref.order(o.order.number), want: ref.order(o.order.number), why: 'ORD ref' },
    { q: `ord ${o.order.number}`, want: ref.order(o.order.number), why: '"ord 12" with a space' },
    { q: `HPO-${TU}`, want: ref.order(o.order.number), why: 'customer PO (admin)' },
    { q: `hpo-${T}`, want: ref.order(o.order.number), why: 'customer PO lower case' },
    { q: `ENQ-${TU}`, want: ref.rfq(r.rfq.number), why: 'customer reference prefix' },
    { q: `item ${T} pressure`, want: `pressure switch`, why: 'order item words' },
    { q: 'حسن انڈسٹریز', want: urdu.name, why: 'Urdu company name' },
    { q: `back\\slash ${T}`, want: slash.name, why: 'name with a backslash' },
    { q: `100% pure ${T}`, want: pct.name, why: 'name with a percent sign' },
    { q: `under_score ${T}`, want: und.name, why: 'name with an underscore' },
    { q: `  srch   ${T}  `, want: co.name, why: 'extra spaces around and between words' },
    { q: '%', why: 'bare percent (must not match everything)' },
    { q: '_', why: 'bare underscore (must not match everything)' },
    { q: '\\', why: 'bare backslash' },
    { q: "O'Brien & Sons", why: 'apostrophe and ampersand' },
    { q: "'; drop table companies; --", why: 'SQL-ish' },
    { q: '((([[[', why: 'brackets' },
    { q: '.*+?^$|', why: 'regex characters' },
    { q: 'PO-26-', why: 'supplier PO prefix with no number' },
    { q: '😀 gauge', why: 'emoji' },
    { q: 'x'.repeat(300), why: '300 characters' },
  ]

  const ctx = await ctxAs(browser, info, 'admin', 'desktop')
  const page = await newPage(ctx, info, 'palette/admin')
  await visit(page, info, '/today', 'palette')
  const dialog = await openPalette(page)
  for (const c of cases)
    await probe(info, page, `palette "${c.q.slice(0, 40)}" (${c.why})`, async () => {
      const a = await paletteAsk(page, dialog, c.q)
      const err = await dialog.getByText(/went wrong|could not search|couldn.t search|error/i).count()
      if (err) note(info, { kind: 'observation', where: `palette ${c.why}`, what: `error text shown for "${c.q.slice(0, 60)}"`, detail: a.options.slice(0, 6) })
      if (a.status !== null && a.status >= 400) note(info, { kind: 'observation', where: `palette ${c.why}`, what: `search_all answered ${a.status} for "${c.q.slice(0, 60)}"` })
      if (a.ms > 2500) note(info, { kind: 'slow', where: `palette ${c.why}`, what: `results took ${a.ms} ms` })
      if (c.want) {
        const hit = a.options.some(o => (typeof c.want === 'string' ? o.toLowerCase().includes(c.want.toLowerCase()) : c.want!.test(o)))
        if (!hit) note(info, { kind: 'observation', where: `palette ${c.why}`, what: `palette shows nothing for a valid "${c.q.slice(0, 60)}" (wanted ${String(c.want)})`, detail: a.options.slice(0, 8) })
      }
      if (c.q === '%' || c.q === '_') {
        const companies = a.options.filter(o => !/^(Add “|New RFQ for)/.test(o))
        const literal = companies.filter(o => o.includes(c.q))
        if (companies.length - literal.length >= 3)
          note(info, { kind: 'observation', where: `palette ${c.why}`, what: `"${c.q}" acts as a wildcard: ${companies.length} results without that character`, detail: companies.slice(0, 6) })
      }
      if (c.q.length > 100 && a.options.some(o => /^Add “/.test(o)))
        note(info, { kind: 'observation', where: 'palette 300 characters', what: 'palette offers to add a 300-character text as a new company (search_all ignores input over 100 characters)' })
    })
  await probe(info, page, 'palette Escape closes it and focus is not lost', async () => {
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 })
    const focused = await page.evaluate(() => document.activeElement?.tagName ?? 'none')
    if (focused === 'BODY') note(info, { kind: 'observation', where: 'palette Escape', what: 'after closing the palette focus fell to <body>' })
  })
  await ctx.close()

  // Phone: opened from the Search button, a short query, layout of the sheet.
  const pctx = await ctxAs(browser, info, 'sales', 'phone')
  const pp = await newPage(pctx, info, 'palette/sales/phone')
  await probe(info, pp, 'palette phone open and search', async () => {
    await visit(pp, info, '/today', 'palette phone')
    await pp.getByRole('button', { name: 'Search', exact: true }).filter({ visible: true }).first().click()
    const d = pp.getByRole('dialog', { name: 'Search or jump to' })
    await d.waitFor({ timeout: 8_000 })
    const a = await paletteAsk(pp, d, `srch ${T}`)
    if (!a.options.some(o => o.includes(co.name))) note(info, { kind: 'observation', where: 'palette phone', what: 'phone palette did not find the company', detail: a.options.slice(0, 6) })
    await layout(pp, info, 'palette phone')
    await shot(pp, 'palette-phone-results', false)
    await pp.goBack()
    await pp.waitForTimeout(500)
    if (await d.isVisible()) note(info, { kind: 'observation', where: 'palette phone', what: 'Back did not close the palette on a phone' })
    if (!/\/today/.test(pp.url())) note(info, { kind: 'observation', where: 'palette phone', what: `Back with the palette open left Today for ${pp.url()}` })
  })
  await pctx.close()
})

test('crosscut: single-key shortcuts never fire while typing; Help panel and menus', async ({ browser }, info) => {
  const co = await company(`Hunt Keys ${T}`)
  const r = await rfq({ customer: co, items: [{ description: `Hunt keys gauge ${T}`, qty: 1 }] })
  const ctx = await ctxAs(browser, info, 'admin', 'desktop')
  const page = await newPage(ctx, info, 'shortcuts/admin')
  const capture = page.getByRole('dialog', { name: /^(Capture|Paste or photo)$/ })
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  const fired = async (where: string, path: RegExp) => {
    const out: string[] = []
    if (!path.test(new URL(page.url()).pathname)) out.push(`moved to ${new URL(page.url()).pathname}`)
    if (await capture.isVisible()) out.push('Capture sheet opened')
    if (await sheet.isVisible()) out.push('Keyboard shortcuts sheet opened')
    if (out.length) note(info, { kind: 'observation', where, what: `a shortcut fired while typing: ${out.join(', ')}` })
    return out.length > 0
  }
  const reset = async (path: string) => {
    await page.keyboard.press('Escape').catch(() => undefined)
    await visit(page, info, path, 'shortcuts')
  }

  await probe(info, page, 'keys in the RFQ list filter', async () => {
    await reset('/rfqs')
    const box = page.getByRole('textbox', { name: 'Search RFQs' })
    await box.click()
    await page.keyboard.type('ncgt?/')
    await page.waitForTimeout(400)
    await fired('keys in Search RFQs', /^\/rfqs$/)
    const v = await box.inputValue()
    if (v !== 'ncgt?/') note(info, { kind: 'observation', where: 'keys in Search RFQs', what: `typed "ncgt?/" but the box holds "${v}"` })
  })
  await probe(info, page, 'keys in the palette', async () => {
    await reset('/orders')
    const d = await openPalette(page)
    await d.getByRole('combobox').pressSequentially('ncg t?', { delay: 20 })
    await page.waitForTimeout(400)
    await fired('keys in the palette', /^\/orders$/)
    if (!(await d.isVisible())) note(info, { kind: 'observation', where: 'keys in the palette', what: 'palette closed while typing' })
    await page.keyboard.press('Escape')
  })
  await probe(info, page, 'keys in a dialog text box (Add an item)', async () => {
    await reset(`/rfqs/${r.rfq.id}`)
    await page.getByRole('button', { name: 'Add item' }).first().click()
    const d = page.getByRole('dialog', { name: 'Add an item' })
    await d.getByLabel('Description').pressSequentially('c n g t ?', { delay: 20 })
    await page.waitForTimeout(400)
    await fired('keys in Add an item', new RegExp(`^/rfqs/${r.rfq.id}$`))
    // Ctrl+K while a dialog is open
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(600)
    if (await page.getByRole('dialog', { name: 'Search or jump to' }).isVisible())
      note(info, { kind: 'observation', where: 'Ctrl+K over a dialog', what: 'the palette opens on top of an open Add an item dialog (typed text sits under it)' })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
  })
  await probe(info, page, 'C with a menu open', async () => {
    await reset(`/companies/${co.id}`)
    await page.getByRole('button', { name: /^(More|More actions)$/ }).filter({ visible: true }).first().click()
    await page.getByRole('menuitem').first().waitFor({ timeout: 5_000 })
    await page.keyboard.press('c')
    await page.waitForTimeout(500)
    if (await capture.isVisible()) note(info, { kind: 'observation', where: 'C with the company More menu open', what: 'C opened Paste or photo while a menu was open (PaletteHost skips role=menu, CaptureProvider does not)' })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
  })
  await probe(info, page, 'shortcuts turned off: C and N', async () => {
    await reset('/today')
    await page.evaluate(() => localStorage.setItem('qtech.single-keys', 'off'))
    await page.reload()
    await settle(page)
    await blur(page)
    await page.keyboard.press('c')
    await page.waitForTimeout(500)
    if (await capture.isVisible()) note(info, { kind: 'observation', where: 'single-key shortcuts off', what: 'C still opens Paste or photo with single-key shortcuts turned off (CaptureProvider ignores the setting)' })
    await page.keyboard.press('Escape')
    await blur(page)
    await page.keyboard.press('n')
    await page.waitForTimeout(500)
    if (/\/rfqs\/new/.test(page.url())) note(info, { kind: 'observation', where: 'single-key shortcuts off', what: 'N still opens New RFQ with shortcuts turned off' })
    await page.evaluate(() => localStorage.removeItem('qtech.single-keys'))
  })
  await probe(info, page, 'G then T, ? and / outside text boxes', async () => {
    await reset('/orders')
    await blur(page)
    await page.keyboard.press('g')
    await page.keyboard.press('t')
    await page.waitForURL(/\/today/, { timeout: 5_000 }).catch(() => note(info, { kind: 'observation', where: 'G then T', what: `G then T did not go to Today (at ${page.url()})` }))
    await blur(page)
    await page.keyboard.press('Shift+?')
    if (!(await sheet.isVisible().catch(() => false))) await sheet.waitFor({ timeout: 3_000 }).catch(() => note(info, { kind: 'observation', where: '?', what: '? did not open Keyboard shortcuts' }))
    await page.keyboard.press('Escape')
    await reset('/companies')
    await blur(page)
    await page.keyboard.press('/')
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName)
    if (focused !== 'Search companies') note(info, { kind: 'observation', where: '/ on Companies', what: `/ focused ${focused}, not Search companies` })
    await page.keyboard.type('zz')
    await page.keyboard.press('Escape')
    const v = await page.getByRole('textbox', { name: 'Search companies' }).inputValue()
    if (v !== '') note(info, { kind: 'observation', where: 'Esc in Search companies', what: `Esc did not clear the search ("${v}")` })
  })
  await probe(info, page, 'keys while the Help side panel is open', async () => {
    await reset('/rfqs?help=')
    await page.getByRole('dialog', { name: 'Help' }).waitFor({ timeout: 8_000 })
    await page.getByRole('heading', { name: 'RFQs', level: 1 }).click()
    await blur(page)
    await page.keyboard.press('/')
    await page.waitForTimeout(300)
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName)
    await page.keyboard.press('n')
    await page.waitForTimeout(500)
    if (focused !== 'Search RFQs' && !/\/rfqs\/new/.test(page.url()))
      note(info, { kind: 'observation', where: 'Help side panel open', what: 'with the non-modal Help panel open, / and N do nothing on the page (isTypingContext treats any role=dialog as typing)' })
    await shot(page, 'help-open-keys')
  })
  await ctx.close()
})

// ================================================================================================ help

test('crosscut: Help from every main screen, its recipes, and the How it works cards', async ({ browser }, info) => {
  const co = await company(`Hunt Help ${T}`)
  const r = await rfq({ customer: co, items: [{ description: `Hunt help item ${T}`, qty: 1 }] })
  const o = await order({ customer: co, lines: [{ description: `Hunt help line ${T}`, qty: 1, price: 500 }], owner: 'sales' })
  const screens = ['/today', '/rfqs', '/rfqs/new', `/rfqs/${r.rfq.id}`, '/orders', `/orders/${o.order.id}`, '/companies', `/companies/${co.id}`, '/money/receivables', '/settings']

  for (const [role, vp, list] of [
    ['sales', 'desktop', screens],
    ['engineer', 'phone', ['/today', `/orders/${o.order.id}`, '/rfqs']],
  ] as [Role, Viewport, string[]][]) {
    const ctx = await ctxAs(browser, info, role, vp)
    const page = await newPage(ctx, info, `help/${role}/${vp}`)
    const help = page.getByRole('dialog', { name: 'Help' })
    for (const path of list)
      await probe(info, page, `help ${role}/${vp} ${path}`, async () => {
        await visit(page, info, `${path}${path.includes('?') ? '&' : '?'}help=`, `help ${role}/${vp}`)
        await help.waitFor({ timeout: 10_000 })
        const here = help.locator('section').filter({ has: page.getByRole('heading', { name: 'For this screen' }) })
        const buttons = here.getByRole('button')
        const n = await buttons.count()
        if (n === 0) note(info, { kind: 'observation', where: `help ${role}/${vp} ${path}`, what: 'no "For this screen" recipes on this screen' })
        for (let i = 0; i < Math.min(n, 3); i++) {
          const title = (await buttons.nth(i).innerText()).trim()
          await buttons.nth(i).click()
          const ok = await help.getByText('How do I…').first().isVisible({ timeout: 5_000 }).catch(() => false)
          const gone = await help.getByText(/not here any more/).count()
          if (!ok || gone) note(info, { kind: 'observation', where: `help ${path}`, what: `recipe "${title}" did not open (${page.url()})` })
          if (i === 0 && vp === 'phone') await layout(page, info, `help recipe ${role}/${vp}`)
          const back = help.getByRole('button', { name: /^(All help|Back to all help)$/ }).first()
          await back.click()
        }
        await help.getByRole('button', { name: 'Close help' }).first().click()
        await help.waitFor({ state: 'hidden', timeout: 5_000 })
        if (/[?&]help=/.test(page.url())) note(info, { kind: 'observation', where: `help ${path}`, what: `Close help left ?help= in the address (${page.url()})` })
      })
    await probe(info, page, `help ${role}/${vp} unknown recipe and search`, async () => {
      await visit(page, info, '/today?help=no-such-recipe', 'help unknown')
      await help.waitFor({ timeout: 8_000 })
      if ((await help.getByText(/not here any more/).count()) === 0) note(info, { kind: 'observation', where: 'help unknown id', what: '?help=no-such-recipe shows no "not here any more" line' })
      const box = help.getByRole('searchbox').or(help.getByRole('textbox')).first()
      await box.fill('chase')
      if ((await help.getByText(/answers? for/).count()) === 0) note(info, { kind: 'observation', where: 'help search', what: '"chase" finds no help answer' })
      await box.fill('qwxzzy')
      if ((await help.getByText(/Nothing matches/).count()) === 0) note(info, { kind: 'observation', where: 'help search', what: 'nonsense search shows no "Nothing matches"' })
      await box.fill('ٹیکس')
      await shot(page, `help-search-${role}-${vp}`, false)
    })
    await ctx.close()
  }

  for (const role of ['sales', 'admin', 'engineer'] as Role[]) {
    const ctx = await ctxAs(browser, info, role, 'desktop')
    const page = await newPage(ctx, info, `howitworks/${role}`)
    await probe(info, page, `How it works card ${role}`, async () => {
      await page.addInitScript(() => {
        for (const k of Object.keys(localStorage)) if (k.startsWith('qtech.howItWorks.')) localStorage.removeItem(k)
      })
      await visit(page, info, '/today', `howitworks ${role}`)
      const card = page.locator('section').filter({ has: page.getByRole('heading', { name: /How Q-Tech CRM works/ }) }).first()
      if (!(await card.isVisible().catch(() => false))) {
        note(info, { kind: 'observation', where: `How it works ${role}`, what: 'the How Q-Tech CRM works card is not on Today (dismissed or "long ago")' })
        return
      }
      const shows = card.getByRole('button', { name: 'Show me' })
      const n = await shows.count()
      const help = page.getByRole('dialog', { name: 'Help' })
      for (let i = 0; i < n; i++) {
        await shows.nth(i).click()
        await help.waitFor({ timeout: 8_000 })
        const ok = await help.getByText('How do I…').first().isVisible({ timeout: 5_000 }).catch(() => false)
        if (!ok || (await help.getByText(/not here any more/).count())) note(info, { kind: 'observation', where: `How it works ${role}`, what: `Show me #${i + 1} did not open a recipe (${page.url()})` })
        await help.getByRole('button', { name: 'Close help' }).first().click()
        await help.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined)
      }
      await shot(page, `howitworks-${role}`, false)
    })
    await ctx.close()
  }
})

// ================================================================================================ long lists: RFQ board and Orders

test('crosscut: RFQ board and Orders with long lists, filters, sort, Back and refresh', async ({ browser }, info) => {
  // Its own tag: every other test in this file names its records with T, and the board and orders searches find those too.
  const L = tag(6)
  const LU = L.toUpperCase()
  const cust = await post<{ id: string; name: string }>('companies', { name: `Hunt Long List ${L} Engineering` })
  await postMany(
    'rfqs',
    Array.from({ length: 60 }, (_, i) => ({ company_id: cust.id, owner_id: USER.admin, due_on: karachiDay((i % 20) - 5), customer_ref: `HL-${LU}-${i}` })),
  )
  await probe(info, null, 'seed 30 closed RFQs', () =>
    postMany('rfqs', Array.from({ length: 30 }, (_, i) => ({ company_id: cust.id, owner_id: USER.sales, closed_on: karachiDay(-(i % 10)), close_reason: 'other', customer_ref: `HLC-${LU}-${i}` }))),
  )
  for (let i = 0; i < 3; i++) await order({ customer: cust, lines: [{ description: `Hunt list line ${L} ${i}`, qty: 1 + i, price: 1000 * (i + 1) }], owner: i === 0 ? 'admin' : 'sales', customerPo: `HLPO-${LU}-${i}` })

  const ctx = await ctxAs(browser, info, 'admin', 'desktop')
  const page = await newPage(ctx, info, 'lists/admin')
  const mainScroll = (y?: number) => page.evaluate(v => {
    const m = document.getElementById('main') as HTMLElement
    if (v !== undefined) m.scrollTop = v
    return m.scrollTop
  }, y)

  await probe(info, page, 'board: search keeps 60 rows and the URL', async () => {
    await visit(page, info, `/rfqs?owner=all&q=${L}`, 'board')
    const t = await mainText(page)
    const m = /Showing (\d+) of (\d+)/.exec(t)
    if (!m || Number(m[1]) !== 60) note(info, { kind: 'observation', where: 'board search', what: `expected Showing 60 for the seeded customer, got "${m?.[0] ?? 'no summary'}"` })
    if ((await page.getByRole('textbox', { name: 'Search RFQs' }).inputValue()) !== L) note(info, { kind: 'observation', where: 'board search', what: 'the search box does not show ?q=' })
    await layout(page, info, 'board 60 rows')
    await shot(page, 'board-60-rows', false)
  })
  await probe(info, page, 'board: header stays visible while the list scrolls', async () => {
    await mainScroll(1400)
    await page.waitForTimeout(300)
    const geo = await page.evaluate(() => {
      const main = document.getElementById('main') as HTMLElement
      const th = document.querySelector('#main table thead th') as HTMLElement | null
      return { mainTop: main.getBoundingClientRect().top, thTop: th ? th.getBoundingClientRect().top : null, scroll: main.scrollTop }
    })
    if (geo.thTop === null || geo.thTop < geo.mainTop - 2)
      note(info, { kind: 'observation', where: 'board sticky header', what: `table header scrolled out of view (th top ${geo.thTop}, #main top ${geo.mainTop}, scrolled ${geo.scroll}): th is sticky inside an overflow-auto wrapper that does not scroll`, detail: geo })
    await shot(page, 'board-scrolled', false)
  })
  await probe(info, page, 'board: sort, open a row, Back keeps scroll, search and sort', async () => {
    await mainScroll(0)
    const due = page.getByRole('columnheader', { name: /Due/ }).first()
    await due.getByRole('button').first().click().catch(() => due.click())
    await due.getByRole('button').first().click().catch(() => due.click())
    const sortBefore = await due.getAttribute('aria-sort')
    await mainScroll(900)
    await page.waitForTimeout(300)
    const y = await mainScroll()
    const link = page.locator('#main table tbody a[href^="/rfqs/"]').filter({ visible: true })
    let target: Locator | null = null
    for (let i = 0; i < (await link.count()); i++) {
      const box = await link.nth(i).boundingBox()
      if (box && box.y > 200 && box.y < 650) {
        target = link.nth(i)
        break
      }
    }
    await (target ?? link.first()).click()
    await page.waitForURL(/\/rfqs\/[0-9a-f-]{36}/, { timeout: 10_000 })
    await settle(page)
    await page.goBack()
    await page.waitForURL(/\/rfqs\?/, { timeout: 10_000 })
    await settle(page)
    const back = await until(() => mainScroll(), v => Math.abs(v - y) < 80, 3_000)
    if (Math.abs(back - y) >= 80) note(info, { kind: 'observation', where: 'board Back', what: `scroll place not restored: left at ${y}, back at ${back}` })
    if (!page.url().includes(`q=${L}`)) note(info, { kind: 'observation', where: 'board Back', what: `search lost on Back (${page.url()})` })
    const sortAfter = await page.getByRole('columnheader', { name: /Due/ }).first().getAttribute('aria-sort')
    if (sortAfter !== sortBefore) note(info, { kind: 'observation', where: 'board Back', what: `sort not kept on Back: ${sortBefore} -> ${sortAfter} (DataTable sort is component state, not in the URL)` })
    await page.goForward()
    await page.waitForURL(/\/rfqs\/[0-9a-f-]{36}/, { timeout: 10_000 })
    await page.goBack()
    await page.reload()
    await settle(page)
    const sortReload = await page.getByRole('columnheader', { name: /Due/ }).first().getAttribute('aria-sort')
    if (sortReload !== sortBefore) note(info, { kind: 'observation', where: 'board refresh', what: `sort lost on refresh: ${sortBefore} -> ${sortReload}` })
  })
  await probe(info, page, 'board: lede and counts with Mine and All', async () => {
    await visit(page, info, `/rfqs?owner=mine`, 'board mine')
    const mine = await page.locator('#main header p, #main p').first().innerText().catch(() => '')
    const mineShow = /Showing (\d+) of (\d+)/.exec(await mainText(page))?.[0] ?? ''
    await visit(page, info, `/rfqs?owner=all`, 'board all')
    const all = await page.locator('#main header p, #main p').first().innerText().catch(() => '')
    const allShow = /Showing (\d+) of (\d+)/.exec(await mainText(page))?.[0] ?? ''
    if (mine === all && mineShow !== allShow)
      note(info, { kind: 'observation', where: 'board lede', what: `the lede ("${mine}") is the same for Mine and All while the list differs (${mineShow} vs ${allShow}): "need you" and "overdue" count everyone's RFQs` })
  })
  await probe(info, page, 'board: closed list pages, refresh on page 2, page=999', async () => {
    await visit(page, info, `/rfqs?show=closed&q=${L}`, 'board closed')
    await page.waitForTimeout(800) // the closed search is debounced
    await settle(page)
    const pages = page.getByRole('navigation', { name: 'Pages' })
    if (!(await pages.isVisible().catch(() => false))) {
      note(info, { kind: 'observation', where: 'board closed', what: 'no page buttons for 30 closed RFQs of one customer', detail: (await mainText(page)).slice(0, 300) })
      return
    }
    await pages.getByRole('button', { name: 'Next' }).click()
    await page.waitForURL(/page=2/, { timeout: 5_000 })
    await page.reload()
    await settle(page)
    if (!/Page 2 of/.test(await mainText(page))) note(info, { kind: 'observation', where: 'board closed', what: 'page 2 not kept on refresh' })
    await visit(page, info, `/rfqs?show=closed&q=${L}&page=999`, 'board closed 999')
    await page.waitForTimeout(800)
    const t = (await mainText(page)).replace(/\s+/g, ' ')
    note(info, { kind: 'observation', where: 'board closed page=999', what: `shows: ${t.slice(0, 240)}` })
    await shot(page, 'board-closed-page-999', false)
  })
  await probe(info, page, 'orders: search, sort, filters in the URL, refresh, junk', async () => {
    await visit(page, info, `/orders?owner=all&q=${L}`, 'orders')
    const m = /Showing (\d+) of/.exec(await mainText(page))
    if (!m || Number(m[1]) !== 3) note(info, { kind: 'observation', where: 'orders search', what: `expected 3 orders for the customer, got "${m?.[0] ?? 'none'}"` })
    const head = page.getByRole('columnheader', { name: /^Order/ }).first()
    await head.getByRole('button').first().click().catch(() => head.click())
    const sortBefore = await head.getAttribute('aria-sort')
    await page.reload()
    await settle(page)
    const sortAfter = await page.getByRole('columnheader', { name: /^Order/ }).first().getAttribute('aria-sort')
    if (sortAfter !== sortBefore) note(info, { kind: 'observation', where: 'orders refresh', what: `sort lost on refresh: ${sortBefore} -> ${sortAfter}` })
    await page.getByRole('button', { name: /^Filters?/ }).filter({ visible: true }).first().click()
    const goods = page.getByLabel('Goods state')
    const values = await goods.locator('option').evaluateAll(os => os.map(o => (o as HTMLOptionElement).value).filter(Boolean))
    if (values.length) {
      await goods.selectOption(values[0])
      await page.waitForURL(/goods=/, { timeout: 5_000 })
      await page.keyboard.press('Escape')
      await page.reload()
      await settle(page)
      if (!page.url().includes(`goods=${values[0]}`)) note(info, { kind: 'observation', where: 'orders filter', what: 'goods filter lost on refresh' })
    }
    await visit(page, info, '/orders?tab=nonsense&goods=bogus&payment=zzz&show=need&owner=nobody', 'orders junk')
    note(info, { kind: 'observation', where: 'orders junk params', what: `shows: ${(await mainText(page)).replace(/\s+/g, ' ').slice(0, 240)}` })
    await shot(page, 'orders-junk-params', false)
  })
  await probe(info, page, 'orders lede "need you" vs Orders nav badge', async () => {
    await visit(page, info, '/orders', 'orders mine')
    const lede = /(\d+) need you/.exec(await mainText(page))
    const n = await todayNumbers(page)
    if (lede && n.nav.Orders !== undefined && Number(lede[1]) !== n.nav.Orders)
      note(info, { kind: 'observation', where: 'orders counts', what: `Orders page says ${lede[1]} need you, the Orders nav badge says ${n.nav.Orders} (two different rules)` })
  })
  await ctx.close()

  const pctx = await ctxAs(browser, info, 'admin', 'phone')
  const pp = await newPage(pctx, info, 'lists/admin/phone')
  await probe(info, pp, 'board phone: 60 cards, filter sheet, layout', async () => {
    await visit(pp, info, `/rfqs?owner=all&q=${L}`, 'board phone')
    await layout(pp, info, 'board phone')
    await shot(pp, 'board-phone', false)
    await pp.evaluate(() => {
      const m = document.getElementById('main') as HTMLElement
      m.scrollTop = m.scrollHeight
    })
    await pp.waitForTimeout(300)
    await layout(pp, info, 'board phone bottom')
    await shot(pp, 'board-phone-bottom', false)
    const sheetBtn = pp.getByRole('button', { name: /^Filters?/ }).filter({ visible: true }).first()
    if (await sheetBtn.count()) {
      await sheetBtn.click()
      await pp.waitForTimeout(400)
      await layout(pp, info, 'board phone filter sheet')
      await shot(pp, 'board-phone-filter-sheet', false)
      await pp.keyboard.press('Escape')
    }
    await visit(pp, info, `/orders?owner=all&q=${L}`, 'orders phone')
    await layout(pp, info, 'orders phone')
    await shot(pp, 'orders-phone', false)
  })
  await pctx.close()
})

// ================================================================================================ companies

test('crosscut: companies: new, near-duplicates, merge, no delete, a stale second tab', async ({ browser }, info) => {
  // Made before any page loads: the Merge dialog picks from the cached company list (30 s fresh, kept across reloads), so a
  // company made after /companies was opened is not offered for a while (run 1).
  const keep = await post<{ id: string; name: string }>('companies', { name: `Hunt Merge Keep ${T}` })
  const drop = await post<{ id: string; name: string }>('companies', { name: `Hunt Merge Keep ${T} Pvt` })
  const ctx = await ctxAs(browser, info, 'admin', 'desktop')
  const page = await newPage(ctx, info, 'companies/admin')
  const base = `Hunt Dup ${T} Traders`
  const countLike = () => db.count(`companies?name=ilike.*Dup*${T}*Traders*&select=id`)
  const addCompany = async (name: string) => {
    await visit(page, info, '/companies', 'companies')
    await page.getByRole('button', { name: 'New company' }).first().click()
    const d = page.getByRole('dialog', { name: 'New company' })
    await d.getByRole('textbox', { name: /Company name/ }).fill(name)
    await d.getByRole('button', { name: /^(Add company|Try again)$/ }).click()
    await page.waitForTimeout(1500)
    return d
  }
  await probe(info, page, 'new company from the dialog', async () => {
    await addCompany(base)
    await page.getByRole('heading', { name: base, level: 1 }).waitFor({ timeout: 10_000 })
    if ((await countLike()) !== 1) note(info, { kind: 'observation', where: 'new company', what: `expected one "${base}" in the DB` })
  })
  for (const [variant, why] of [
    [`Hunt  Dup  ${T}  Traders`, 'doubled inner spaces'],
    [`${base}\u00a0`, 'a trailing no-break space'],
    [`hunt dup ${T} TRADERS.`, 'a trailing full stop'],
  ] as [string, string][])
    await probe(info, page, `near-duplicate with ${why}`, async () => {
      const before = await countLike()
      const d = await addCompany(variant)
      const after = await countLike()
      const warned = await d.getByText(/already exists/).isVisible().catch(() => false)
      if (after > before) note(info, { kind: 'observation', where: 'companies duplicate', what: `"${variant.replace(/\u00a0/g, '<nbsp>')}" (${why}) was saved as a second company next to "${base}" without a warning (unique index is lower(btrim(name)) only)` })
      else if (!warned) note(info, { kind: 'observation', where: 'companies duplicate', what: `"${why}" variant neither saved nor warned`, detail: (await mainText(page)).slice(0, 200) })
      await page.keyboard.press('Escape')
    })

  await probe(info, page, 'merge a duplicate: RFQ and contact move, duplicate removed', async () => {
    const r = await post<{ id: string }>('rfqs', { company_id: drop.id, owner_id: USER.sales })
    const c = await post<{ id: string }>('contacts', { company_id: drop.id, name: `Hunt Merge Contact ${T}` })
    await visit(page, info, `/companies/${drop.id}`, 'merge')
    await page.getByRole('button', { name: /^(More|More actions)$/ }).filter({ visible: true }).first().click()
    await page.getByRole('menuitem', { name: 'Merge into another company' }).click()
    const d = page.getByRole('dialog', { name: 'Merge duplicate company' })
    const box = d.getByRole('combobox')
    await box.click()
    await box.pressSequentially(`Merge Keep ${T}`, { delay: 20 })
    const option = page.getByRole('option', { name: `Hunt Merge Keep ${T}`, exact: true })
    if (!(await option.isVisible({ timeout: 8_000 }).catch(() => false))) {
      const offered = await page.getByRole('option').allInnerTexts()
      note(info, { kind: 'observation', where: 'merge', what: `the Merge into list does not offer "${keep.name}" (made before the page opened)`, detail: offered.slice(0, 8) })
      // The list is cached: a reload past its 30 s freshness should bring it.
      await page.waitForTimeout(31_000)
      await visit(page, info, `/companies/${drop.id}`, 'merge retry')
      await page.getByRole('button', { name: /^(More|More actions)$/ }).filter({ visible: true }).first().click()
      await page.getByRole('menuitem', { name: 'Merge into another company' }).click()
      await box.click()
      await box.pressSequentially(`Merge Keep ${T}`, { delay: 20 })
    }
    // The list is a portal outside the dialog.
    await option.click()
    await d.getByRole('button', { name: /^Merge into/ }).click()
    await page.waitForURL(new RegExp(`/companies/${keep.id}`), { timeout: 10_000 }).catch(() => note(info, { kind: 'observation', where: 'merge', what: `after merge the page is ${page.url()}, not the kept company` }))
    const rr = await db.one<{ company_id: string }>(`rfqs?id=eq.${r.id}&select=company_id`)
    const cc = await db.one<{ company_id: string }>(`contacts?id=eq.${c.id}&select=company_id`)
    const left = await db.count(`companies?id=eq.${drop.id}&select=id`)
    if (rr.company_id !== keep.id || cc.company_id !== keep.id || left !== 0) note(info, { kind: 'observation', where: 'merge', what: 'merge did not move everything or did not remove the duplicate', detail: { rfq: rr.company_id, contact: cc.company_id, dropLeft: left } })
    // The old address of the removed company
    await visit(page, info, `/companies/${drop.id}`, 'merged away')
    note(info, { kind: 'observation', where: 'merged company address', what: `opening the removed company shows: ${(await mainText(page)).replace(/\s+/g, ' ').slice(0, 160)}` })
  })

  await probe(info, page, 'is there a delete for a company in use', async () => {
    const co = await company(`Hunt Del ${T}`)
    await post('rfqs', { company_id: co.id, owner_id: USER.sales })
    await visit(page, info, `/companies/${co.id}`, 'delete')
    await page.getByRole('button', { name: /^(More|More actions)$/ }).filter({ visible: true }).first().click()
    const items = (await page.getByRole('menuitem').allInnerTexts()).map(s => s.trim())
    if (!items.some(i => /delete|remove/i.test(i))) note(info, { kind: 'observation', where: 'company delete', what: `no delete or remove action for a company; menu has: ${items.join(' | ')} (only merge removes one)` })
    await page.keyboard.press('Escape')
  })

  await probe(info, page, 'two tabs: a save from the stale tab', async () => {
    const co = await company(`Hunt Two Tabs ${T}`, { city: 'Lahore' })
    const a = page
    const b = await newPage(ctx, info, 'companies/admin/tabB')
    await visit(a, info, `/companies/${co.id}`, 'tab A')
    await visit(b, info, `/companies/${co.id}`, 'tab B')
    // A: notes
    await a.bringToFront()
    await a.getByRole('button', { name: /^(More|More actions)$/ }).filter({ visible: true }).first().click()
    await a.getByRole('menuitem', { name: 'Edit company' }).click()
    const da = a.getByRole('dialog', { name: 'Edit company' })
    await da.getByLabel('Notes').fill(`Notes from tab A ${T}`)
    await da.getByRole('button', { name: 'Save changes' }).click()
    await da.waitFor({ state: 'hidden', timeout: 10_000 })
    // B comes back to the front: does it refresh?
    await b.bringToFront()
    await b.evaluate(() => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await b.waitForTimeout(1500)
    if ((await b.getByText(`Notes from tab A ${T}`).count()) === 0)
      note(info, { kind: 'observation', where: 'two tabs', what: 'the second tab still shows the old company after the first saved and the second came back to the front (focus refetch floor 30 s)' })
    await b.getByRole('button', { name: /^(More|More actions)$/ }).filter({ visible: true }).first().click()
    await b.getByRole('menuitem', { name: 'Edit company' }).click()
    const db2 = b.getByRole('dialog', { name: 'Edit company' })
    const notesInB = await db2.getByLabel('Notes').inputValue()
    await db2.getByLabel('City').fill('Multan')
    await db2.getByRole('button', { name: 'Save changes' }).click()
    await db2.waitFor({ state: 'hidden', timeout: 10_000 })
    const row = await db.one<{ notes: string | null; city: string | null }>(`companies?id=eq.${co.id}&select=notes,city`)
    if (row.notes !== `Notes from tab A ${T}`)
      note(info, { kind: 'observation', where: 'two tabs', what: `a City edit from the stale tab silently wiped the Notes saved in the other tab (notes now ${JSON.stringify(row.notes)}; the stale form held ${JSON.stringify(notesInB)}). EditCompanyDialog sends every field` })
    await b.close()
  })
  await ctx.close()
})

// ================================================================================================ offline saves

test('crosscut: offline saves keep the input, show a plain message, and Try again saves once', async ({ browser }, info) => {
  // The service worker is allowed here (as in production, where it precaches every JS chunk), and warmed up before going offline:
  // with it blocked, the first lazy chunk fetched offline crashes the page, which production never does.
  const ctx = await ctxAs(browser, info, 'sales', 'desktop', { serviceWorkers: 'allow' })
  const page = await newPage(ctx, info, 'offline/sales')
  await page.goto('/today')
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise(r => setTimeout(r, 3000))
    return reg.active?.state
  })
  await page.reload()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 30_000 }).catch(() => note(info, { kind: 'observation', where: 'offline setup', what: 'service worker never took control' }))
  await page.waitForTimeout(3000)
  const probe = async (i: typeof info, p: Page, where: string, fn: () => Promise<unknown>) => {
    try {
      return await huntProbe(i, p, where, fn)
    } finally {
      await ctx.setOffline(false).catch(() => undefined)
    }
  }
  const banner = page.locator('[data-offline-banner]')
  const goOffline = async () => {
    await ctx.setOffline(true)
    await page.waitForTimeout(300)
  }
  const goOnline = async (where: string) => {
    await ctx.setOffline(false)
    const cleared = await banner.waitFor({ state: 'detached', timeout: 15_000 }).then(() => true).catch(() => false)
    if (!cleared) note(info, { kind: 'observation', where, what: `offline banner still shows 15 s after the network came back: "${await banner.innerText().catch(() => '')}"` })
  }
  const bannerShown = async (where: string) => {
    if (!(await banner.isVisible().catch(() => false))) note(info, { kind: 'observation', where, what: 'no offline banner while the browser is offline' })
  }

  await probe(info, page, 'offline new company', async () => {
    const name = `Hunt Offline Co ${T}`
    await visit(page, info, '/companies', 'offline company')
    await page.getByRole('button', { name: 'New company' }).first().click()
    const d = page.getByRole('dialog', { name: 'New company' })
    await d.getByRole('textbox', { name: /Company name/ }).fill(name)
    await goOffline()
    await bannerShown('offline new company')
    await d.getByRole('button', { name: 'Add company' }).click()
    await page.waitForTimeout(1000)
    const msg = await d.innerText()
    if (!NETWORK.test(msg)) note(info, { kind: 'observation', where: 'offline new company', what: 'no plain connection message in the dialog', detail: msg.slice(0, 300) })
    if ((await d.getByRole('textbox', { name: /Company name/ }).inputValue()) !== name) note(info, { kind: 'observation', where: 'offline new company', what: 'the typed name was lost' })
    await shot(page, 'offline-new-company', false)
    await goOnline('offline new company')
    await d.getByRole('button', { name: /^(Try again|Add company)$/ }).click()
    await d.waitFor({ state: 'hidden', timeout: 10_000 })
    const n = await db.count(`companies?name=eq.${encodeURIComponent(name)}&select=id`)
    if (n !== 1) note(info, { kind: 'observation', where: 'offline new company', what: `Try again left ${n} companies named "${name}"` })
  })

  const r = await rfq({ customer: await company(`Hunt Offline Rfq ${T}`), items: [{ description: `Hunt offline item one ${T}`, qty: 1 }] })
  await probe(info, page, 'offline add RFQ item', async () => {
    const desc = `Hunt offline added ${T}`
    await visit(page, info, `/rfqs/${r.rfq.id}`, 'offline add item')
    await page.getByRole('button', { name: 'Add item' }).first().click()
    const d = page.getByRole('dialog', { name: 'Add an item' })
    await d.getByLabel('Description').fill(desc)
    await goOffline()
    await d.getByRole('button', { name: 'Add item' }).last().click()
    await page.waitForTimeout(1000)
    if (!(await d.isVisible())) note(info, { kind: 'observation', where: 'offline add item', what: 'the dialog closed although nothing could be saved' })
    else {
      if (!NETWORK.test(await d.innerText())) note(info, { kind: 'observation', where: 'offline add item', what: 'no plain connection message', detail: (await d.innerText()).slice(0, 300) })
      if ((await d.getByLabel('Description').inputValue()) !== desc) note(info, { kind: 'observation', where: 'offline add item', what: 'the description was lost' })
    }
    await goOnline('offline add item')
    if (await d.isVisible()) {
      await d.getByRole('button', { name: /^(Add item|Try again)$/ }).last().click()
      await d.waitFor({ state: 'hidden', timeout: 10_000 })
    }
    const n = await until(() => db.count(`rfq_items?rfq_id=eq.${r.rfq.id}&description=eq.${encodeURIComponent(desc)}&select=id`), v => v >= 1, 5_000)
    if (n !== 1) note(info, { kind: 'observation', where: 'offline add item', what: `${n} rows for the item after Try again` })
  })

  await probe(info, page, 'offline supplier reply save', async () => {
    const sup = await supplier(`Hunt Offline Supplier ${T}`, 'Pakistan')
    const inq = await quote(r.rfq.id, sup, [], 'PKR')
    await visit(page, info, `/rfqs/${r.rfq.id}`, 'offline reply')
    // The reply form is a dialog named after the supplier, opened by "Enter reply" in Suppliers asked (r3/rfq-orders).
    await page.getByRole('button', { name: `Enter reply, ${sup.name}`, exact: true }).click()
    const region = page.getByRole('dialog', { name: sup.name, exact: true })
    const price = region.getByLabel(`Price for item 1 from ${sup.name}`)
    await price.fill('4321')
    await goOffline()
    await region.getByRole('button', { name: 'Save reply' }).click()
    await page.waitForTimeout(1200)
    const said = (await page.getByRole('status').allInnerTexts()).join(' | ') + ' ' + (await region.innerText())
    if (!NETWORK.test(said)) note(info, { kind: 'observation', where: 'offline reply', what: 'no plain connection message after Save reply offline', detail: said.slice(0, 300) })
    if ((await price.count()) === 0 || !/4,?321/.test(await price.inputValue().catch(() => ''))) note(info, { kind: 'observation', where: 'offline reply', what: 'the typed price is not kept after the failed save' })
    await goOnline('offline reply')
    const again = region.getByRole('button', { name: /^(Save reply|Try again)$/ }).first()
    if (await again.count()) await again.click()
    const n = await until(() => db.count(`supplier_quote_lines?inquiry_id=eq.${inq.id}&select=id`), v => v >= 1, 8_000)
    if (n !== 1) note(info, { kind: 'observation', where: 'offline reply', what: `${n} quote lines after Try again (expected 1)` })
  })

  await probe(info, page, 'offline Delivered today', async () => {
    const sup = await supplier(`Hunt Offline Leg ${T}`, 'Pakistan')
    const o = await order({ suppliers: [{ supplier: sup }], lines: [{ description: `Hunt offline gauge ${T}`, qty: 2, price: 3000, leg: 0, supplierPrice: 2000 }], owner: 'sales' })
    const leg = o.legs[0].id
    await db.patch(`supplier_orders?id=eq.${leg}`, { placed_on: karachiDay(-9), expected_on: karachiDay(-1) })
    await visit(page, info, `/orders/${o.order.id}`, 'offline delivered')
    const btn = page.getByTestId('leg-A').getByRole('button', { name: `Delivered today, ${sup.name}` })
    await goOffline()
    await btn.click()
    await page.waitForTimeout(1200)
    const said = (await page.getByRole('status').allInnerTexts()).join(' | ')
    if (!NETWORK.test(said)) note(info, { kind: 'observation', where: 'offline delivered', what: 'no plain message after Delivered today offline', detail: said.slice(0, 300) })
    const mid = await db.one<{ delivered_on: string | null }>(`supplier_orders?id=eq.${leg}&select=delivered_on`)
    if (mid.delivered_on) note(info, { kind: 'observation', where: 'offline delivered', what: 'delivered_on was set while offline?' })
    const shown = await page.getByTestId('leg-A').innerText()
    if (/Delivered\s+(today|\d)/i.test(shown) && !(await btn.isVisible())) note(info, { kind: 'observation', where: 'offline delivered', what: 'the screen shows Delivered although the save failed (optimistic state not rolled back)' })
    await goOnline('offline delivered')
    if (await btn.isVisible()) await btn.click()
    const after = await until(() => db.one<{ delivered_on: string | null }>(`supplier_orders?id=eq.${leg}&select=delivered_on`), v => v.delivered_on !== null, 8_000)
    if (after.delivered_on !== karachiDay(0)) note(info, { kind: 'observation', where: 'offline delivered', what: `after Try again delivered_on is ${after.delivered_on}` })
  })

  await probe(info, page, 'offline Today chase', async () => {
    const s = await seedChase('sales', 'Offline Chase')
    await visit(page, info, '/today', 'offline chase')
    const scope = await openItem(page, 'desktop', 'chase_customer', s.ref)
    const copy = scope.getByRole('button', { name: /^Copy (message )?and mark chased$/ }).first()
    await goOffline()
    await copy.click()
    await page.waitForTimeout(1500)
    const said = (await page.getByRole('status').allInnerTexts()).join(' | ')
    if (!/not marked/i.test(said) || !NETWORK.test(said)) note(info, { kind: 'observation', where: 'offline chase', what: 'no plain "not marked" + connection message', detail: said.slice(0, 300) })
    if ((await askCount(s.clar)) !== 1) note(info, { kind: 'observation', where: 'offline chase', what: 'ask_count changed while offline' })
    await shot(page, 'offline-chase', false)
    await goOnline('offline chase')
    await copy.click()
    const n = await until(() => askCount(s.clar), v => v >= 2, 8_000)
    if (n !== 2) note(info, { kind: 'observation', where: 'offline chase', what: `after the retry ask_count is ${n} (expected exactly 2)` })
  })
  await ctx.setOffline(false)
  await ctx.close()

  // The banner at phone size.
  const pctx = await ctxAs(browser, info, 'engineer', 'phone')
  const pp = await newPage(pctx, info, 'offline/engineer/phone')
  await probe(info, pp, 'offline banner on a phone', async () => {
    await visit(pp, info, '/today', 'offline phone')
    await pctx.setOffline(true)
    await pp.locator('[data-offline-banner]').waitFor({ timeout: 5_000 }).catch(() => note(info, { kind: 'observation', where: 'offline phone', what: 'no offline banner on a phone' }))
    await layout(pp, info, 'offline banner phone')
    await shot(pp, 'offline-banner-phone', false)
    await pp.getByRole('navigation', { name: 'Main' }).filter({ visible: true }).getByRole('link', { name: /^Orders/ }).click()
    await pp.waitForTimeout(1500)
    note(info, { kind: 'observation', where: 'offline phone Orders', what: `Orders offline shows: ${(await mainText(pp)).replace(/\s+/g, ' ').slice(0, 200)}` })
    await pctx.setOffline(false)
    await pp.locator('[data-offline-banner]').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => note(info, { kind: 'observation', where: 'offline phone', what: 'banner did not clear after reconnecting' }))
  })
  await pctx.close()
})

// ================================================================================================ navigation and session

test('crosscut: Back/Forward through dialogs, refresh, deep link after sign in, sign out in another tab', async ({ browser }, info) => {
  const co = await company(`Hunt Nav ${T}`, { notes: 'Original notes' })
  const r = await rfq({ customer: co, items: [{ description: `Hunt nav gauge ${T}`, qty: 1 }] })
  const o = await order({ customer: co, lines: [{ description: `Hunt nav line ${T}`, qty: 1, price: 900 }], owner: 'sales' })

  for (const vp of ['desktop', 'phone'] as Viewport[]) {
    const ctx = await ctxAs(browser, info, 'sales', vp)
    const page = await newPage(ctx, info, `nav/sales/${vp}`)
    await probe(info, page, `Back/Forward list -> detail -> dialog (${vp})`, async () => {
      await visit(page, info, `/companies?q=${encodeURIComponent(`Nav ${T}`)}`, `nav ${vp}`)
      await page.locator(`#main a[href="/companies/${co.id}"]`).first().click()
      await page.waitForURL(new RegExp(`/companies/${co.id}`), { timeout: 10_000 })
      await settle(page)
      await page.getByRole('button', { name: /^(More|More actions)$/ }).filter({ visible: true }).first().click()
      await page.getByRole('menuitem', { name: 'Edit company' }).click()
      const d = page.getByRole('dialog', { name: 'Edit company' })
      await d.getByLabel('Notes').fill(`Unsaved words ${T}`)
      await page.goBack()
      await page.waitForTimeout(800)
      const url = page.url()
      const open = await d.isVisible()
      if (!url.includes(`/companies/${co.id}`))
        note(info, { kind: 'observation', where: `Back with a dialog open (${vp})`, what: `Back left the company page for ${url} under an open Edit dialog; the typed notes are dropped without asking` })
      else if (open) note(info, { kind: 'observation', where: `Back with a dialog open (${vp})`, what: 'Back did nothing: the dialog is still open' })
      if (url.includes('/companies?') && !url.includes('q=')) note(info, { kind: 'observation', where: `Back to Companies (${vp})`, what: 'the list search was not kept on Back' })
      await page.goForward()
      await page.waitForTimeout(800)
      await page.goBack()
      await page.waitForTimeout(800)
      const notes = await db.one<{ notes: string | null }>(`companies?id=eq.${co.id}&select=notes`)
      if (notes.notes !== 'Original notes') note(info, { kind: 'observation', where: `Back with a dialog (${vp})`, what: `notes changed to ${notes.notes} without Save` })
      await shot(page, `nav-back-forward-${vp}`, false)
    })
    for (const path of [`/rfqs/${r.rfq.id}`, `/orders/${o.order.id}`, `/companies/${co.id}`, `/companies?new=1&name=${encodeURIComponent(`Hunt Refresh ${T}`)}`, '/today?help=today-chase', `/rfqs/new?company=${co.id}`])
      await probe(info, page, `refresh ${path} (${vp})`, async () => {
        await visit(page, info, path, `refresh ${vp}`)
        await page.reload()
        await settle(page)
        const t = await mainText(page)
        if (/Something went wrong|Unexpected error/i.test(t)) note(info, { kind: 'observation', where: `refresh ${path} (${vp})`, what: 'crash screen after refresh' })
        if (path.includes('new=1')) {
          const d = page.getByRole('dialog', { name: 'New company' })
          if (!(await d.isVisible().catch(() => false))) note(info, { kind: 'observation', where: `refresh ${path}`, what: 'the New company dialog is gone after refresh' })
          else if ((await d.getByRole('textbox', { name: /Company name/ }).inputValue()) !== `Hunt Refresh ${T}`) note(info, { kind: 'observation', where: `refresh ${path}`, what: 'the name from ?name= is not in the dialog after refresh' })
          await page.keyboard.press('Escape')
        }
        if (path.includes('help=')) {
          if (!(await page.getByRole('dialog', { name: 'Help' }).isVisible().catch(() => false))) note(info, { kind: 'observation', where: `refresh ${path}`, what: 'Help closed on refresh' })
        }
        if (path.startsWith('/rfqs/new') && !t.includes(co.name)) note(info, { kind: 'observation', where: `refresh ${path}`, what: 'the chosen company is gone from New RFQ after refresh' })
        if (vp === 'phone') await layout(page, info, `refresh ${path} phone`)
      })
    await ctx.close()
  }

  // Deep link while signed out returns to it after sign in.
  const fresh = await blankCtx(browser, info, 'desktop')
  const fp = await newPage(fresh, info, 'deeplink')
  await probe(info, fp, 'deep link while signed out returns after sign in', async () => {
    const target = `/orders/${o.order.id}?from=hunt`
    await fp.goto(target)
    await fp.waitForURL(/\/login/, { timeout: 15_000 })
    await fp.getByLabel('Email').fill('sales@test.invalid')
    await fp.getByLabel('Password', { exact: true }).fill('fixture-only-password')
    await fp.getByRole('button', { name: 'Sign in' }).click()
    await fp.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 15_000 })
    await settle(fp)
    const u = new URL(fp.url())
    if (u.pathname !== `/orders/${o.order.id}`) note(info, { kind: 'observation', where: 'deep link', what: `after sign in landed on ${u.pathname}${u.search}, not ${target}` })
    else if (!u.search.includes('from=hunt')) note(info, { kind: 'observation', where: 'deep link', what: 'the query string was dropped on the way back' })
  })
  await fresh.close()

  // Sign out in one tab while another is open (a fresh engineer session; the shared hunt session file is dropped afterwards).
  const two = await blankCtx(browser, info, 'desktop')
  const t1 = await newPage(two, info, 'signout/tab1')
  await probe(info, t1, 'sign out in one tab, act in the other', async () => {
    await t1.goto('/login')
    await t1.getByLabel('Email').fill('engineer@test.invalid')
    await t1.getByLabel('Password', { exact: true }).fill('fixture-only-password')
    await t1.getByRole('button', { name: 'Sign in' }).click()
    await t1.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 15_000 })
    const t2 = await newPage(two, info, 'signout/tab2')
    await visit(t2, info, `/rfqs/${r.rfq.id}`, 'signout tab2')
    await t1.bringToFront()
    await t1.getByRole('button', { name: /^Account menu/ }).first().click()
    await t1.getByRole('menuitem', { name: 'Sign out' }).click()
    await t1.waitForURL(/\/login/, { timeout: 10_000 })
    await t2.bringToFront()
    const left = await t2.waitForURL(/\/login/, { timeout: 8_000 }).then(() => true).catch(() => false)
    if (!left) {
      note(info, { kind: 'observation', where: 'sign out in another tab', what: `the other tab stays on ${t2.url()} after sign-out elsewhere`, detail: (await mainText(t2)).slice(0, 200) })
      // Act in it: add an item.
      await t2.getByRole('button', { name: 'Add item' }).first().click()
      const d = t2.getByRole('dialog', { name: 'Add an item' })
      await d.getByLabel('Description').fill(`Hunt after signout ${T}`)
      await d.getByRole('button', { name: 'Add item' }).last().click()
      await t2.waitForTimeout(2000)
      const n = await db.count(`rfq_items?rfq_id=eq.${r.rfq.id}&description=eq.${encodeURIComponent(`Hunt after signout ${T}`)}&select=id`)
      note(info, { kind: 'observation', where: 'sign out in another tab', what: `acting in the stale tab: ${n ? 'the item WAS saved' : 'nothing saved'}; page shows ${(await t2.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 160)}` })
      await shot(t2, 'signout-stale-tab', false)
    }
  })
  await two.close()
  // supabase-js signOut is global: every engineer session (the hunt's saved one too) lost its refresh token. Make ctxAs sign in again.
  for (const role of ['engineer'] as Role[])
    try {
      rmSync(join(tmpdir(), 'qtech-hunt', `${role}-${process.pid}.json`), { force: true })
    } catch {
      /* not there */
    }
})

// ================================================================================================ long names at phone size

test('crosscut: a 120-character company and a long contact name at phone size', async ({ browser }, info) => {
  const longName = `Hunt ${T} Mehran Precision Instrumentation and Process Control Engineering Services Private Limited Karachi Div`.slice(0, 120).padEnd(120, 'x')
  const co = await post<{ id: string; name: string }>('companies', { name: longName, city: 'Hyderabad' })
  const contact = await post<{ id: string }>('contacts', { company_id: co.id, name: `Muhammad Abdul Rehman Siddiqui Qureshi ${T} Procurement`, phone: '+92 300 1234567', email: `very.long.procurement.address.${T}@mehran-precision-instrumentation.example` })
  const r = await post<{ id: string; number: number }>('rfqs', { company_id: co.id, owner_id: USER.sales, contact_id: contact.id, due_on: karachiDay(3), customer_ref: `LONG-REF-${TU}-WITH-A-VERY-LONG-CUSTOMER-REFERENCE-0001` })
  await post('rfq_items', { rfq_id: r.id, position: 0, description: `Electromagnetic flow meter DN150 PN16 with remote transmitter, 20 m cable, SS316L electrodes, PTFE liner ${T}`, qty: 2 })
  await postMany('clarifications', [{ rfq_id: r.id, question: 'Please confirm the full process connection standard', first_asked_at: ts(-9), last_asked_at: ts(-9), ask_count: 1 }])
  const sup = await supplier(`Hunt ${T} Shenzhen Long Name Industrial Measurement Technology Co Ltd`, 'China')
  const o = await order({ customer: co, suppliers: [{ supplier: sup, currency: 'CNY' }], lines: [{ description: `Ultrasonic level transmitter with an unusually long description for layout ${T}`, qty: 3, price: 45000, leg: 0, supplierPrice: 5000 }], owner: 'sales', customerPo: `PO/${TU}/2026/PLANT-3/INSTRUMENTATION/LONG` })

  const ctx = await ctxAs(browser, info, 'sales', 'phone')
  const page = await newPage(ctx, info, 'long/sales/phone')
  for (const path of ['/today', `/rfqs?owner=all&q=${T}`, `/rfqs/${r.id}`, `/orders?owner=all&q=${T}`, `/orders/${o.order.id}`, `/companies/${co.id}`, `/companies?q=${T}`])
    await probe(info, page, `long names phone ${path}`, async () => {
      await visit(page, info, path, 'long phone')
      if (path === '/today') {
        const row = page.locator('#main li[data-rule]').filter({ hasText: ref.rfq(r.number) }).first()
        if (await row.count()) await row.getByRole('button').first().click()
      }
      await layout(page, info, `long names phone ${path}`)
      await shot(page, `long-phone-${path}`)
    })
  await probe(info, page, 'long names in the palette on a phone', async () => {
    await visit(page, info, '/today', 'long palette')
    await page.getByRole('button', { name: 'Search', exact: true }).filter({ visible: true }).first().click()
    const d = page.getByRole('dialog', { name: 'Search or jump to' })
    await d.waitFor({ timeout: 8_000 })
    await paletteAsk(page, d, `Hunt ${T} Mehran`)
    await layout(page, info, 'long names palette phone')
    await shot(page, 'long-phone-palette', false)
  })
  await ctx.close()

  const dctx = await ctxAs(browser, info, 'sales', 'desktop')
  const dp = await newPage(dctx, info, 'long/sales/desktop')
  for (const path of [`/rfqs?owner=all&q=${T}`, `/orders/${o.order.id}`, '/today'])
    await probe(info, dp, `long names desktop ${path}`, async () => {
      await visit(dp, info, path, 'long desktop')
      await layout(dp, info, `long names desktop ${path}`)
      await shot(dp, `long-desktop-${path}`, false)
    })
  await dctx.close()
  if (!SERVICE_KEY) note(info, { kind: 'observation', where: 'setup', what: 'SERVICE_ROLE_KEY not set: DB checks read as the admin fixture user' })
})

// ================================================================================================ confirmed bugs, pinned
/*
 * One test per bug the probes above confirmed (run 1, CI 39672642562). The setup runs normally and asserts what it needs, so a
 * broken setup is a red failure; test.fail() sits immediately before the one expect() that states the correct behaviour, so a fix
 * turns the test red ("expected to fail") and it is then flipped to a plain test.
 */
const pinned: BrowserContext[] = []
test.afterEach(async () => {
  for (const c of pinned.splice(0)) await c.close().catch(() => undefined)
})

async function pin(browser: Browser, info: TestInfo, role: Role, vp: Viewport = 'desktop'): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await ctxAs(browser, info, role, vp)
  pinned.push(ctx)
  const page = await ctx.newPage()
  page.setDefaultTimeout(15_000)
  return { ctx, page }
}

async function land(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await page.locator('#main').waitFor({ timeout: 20_000 })
  await settle(page)
}

const moreMenu = (page: Page) => page.getByRole('button', { name: /^(More|More actions)$/ }).filter({ visible: true }).first()

async function editCompany(page: Page, change: (d: Locator) => Promise<void>): Promise<void> {
  await moreMenu(page).click()
  await page.getByRole('menuitem', { name: 'Edit company' }).click()
  const d = page.getByRole('dialog', { name: 'Edit company' })
  await change(d)
  await d.getByRole('button', { name: 'Save changes' }).click()
  await expect(d).toBeHidden({ timeout: 10_000 })
}

test('HW-24: an unknown filter value in the address (/orders?goods=bogus) crashes the Orders page', async ({ browser }, info) => {
  const { page } = await pin(browser, info, 'admin')
  await land(page, '/orders?owner=all')
  await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible()
  await land(page, '/orders?owner=all&goods=bogus')
  test.fail(true, 'HW-24: NoResults names the filter with valueLabel -> resolveStatus, which throws UnknownStatusError for a value it does not know, so the page shows "Something went wrong" (src/features/orders/OrdersListPage.tsx filtersOn)')
  await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible({ timeout: 10_000 })
})

test("HW-25: a stale second tab's Edit company save silently wipes the Notes saved from the first tab", async ({ browser }, info) => {
  const co = await company(`Hunt HW25 ${T}`, { city: 'Lahore' })
  const notes = `Notes from tab A ${T}`
  const { ctx, page: a } = await pin(browser, info, 'admin')
  const b = await ctx.newPage()
  b.setDefaultTimeout(15_000)
  await land(a, `/companies/${co.id}`)
  await land(b, `/companies/${co.id}`)
  await expect(a.getByRole('heading', { name: co.name, level: 1 })).toBeVisible()
  await expect(b.getByRole('heading', { name: co.name, level: 1 })).toBeVisible()
  await a.bringToFront()
  await editCompany(a, d => d.getByLabel('Notes').fill(notes))
  await b.bringToFront()
  await editCompany(b, d => d.getByLabel('City').fill('Multan'))
  const row = await db.one<{ notes: string | null; city: string | null }>(`companies?id=eq.${co.id}&select=notes,city`)
  expect(row.city).toBe('Multan')
  test.fail(true, 'HW-25: EditCompanyDialog sends every field from the form it opened with (src/features/companies/CompanyDialogs.tsx:80), and a tab that comes back within 30 s is not refreshed, so the City save writes the old empty Notes over the other tab\'s')
  expect(row.notes).toBe(notes)
})

test('HW-26: the C shortcut (Paste or photo) still fires with single-key shortcuts turned off, and while a menu is open', async ({ browser }, info) => {
  const { page } = await pin(browser, info, 'admin')
  await land(page, '/today')
  await page.evaluate(() => localStorage.setItem('qtech.single-keys', 'off'))
  await land(page, '/today')
  expect(await page.evaluate(() => localStorage.getItem('qtech.single-keys'))).toBe('off')
  await blur(page)
  await page.keyboard.press('c')
  await page.waitForTimeout(800)
  test.fail(true, 'HW-26: CaptureProvider\'s C handler never reads shortcutsEnabled() and only skips text fields and role=dialog, so it fires with shortcuts off and with a role=menu open (src/app/capture/CaptureProvider.tsx:202-205)')
  await expect(page.getByRole('dialog', { name: /^(Capture|Paste or photo)$/ })).toBeHidden()
})

test('HW-27: with the Help side panel open, / and N do nothing on the page', async ({ browser }, info) => {
  const { page } = await pin(browser, info, 'admin')
  await land(page, '/rfqs?help=')
  await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible()
  await page.getByRole('heading', { name: 'RFQs', level: 1 }).click()
  await blur(page)
  await page.keyboard.press('/')
  test.fail(true, 'HW-27: isTypingContext (src/app/palette/PaletteHost.tsx:184-186) and DataTable\'s / handler treat any role=dialog as typing, and the desktop Help panel is a non-modal dialog beside the page, so every single-key shortcut is dead while it is open')
  await expect(page.getByRole('textbox', { name: 'Search RFQs' })).toBeFocused()
})

test('HW-28: Ctrl+K opens the palette on top of an open dialog', async ({ browser }, info) => {
  const r = await rfq({ customer: await company(`Hunt HW28 ${T}`), items: [{ description: `Hunt hw28 gauge ${T}`, qty: 1 }] })
  const { page } = await pin(browser, info, 'admin')
  await land(page, `/rfqs/${r.rfq.id}`)
  await page.getByRole('button', { name: 'Add item' }).first().click()
  const d = page.getByRole('dialog', { name: 'Add an item' })
  await d.getByLabel('Description').fill(`Half typed ${T}`)
  await expect(d).toBeVisible()
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(800)
  test.fail(true, 'HW-28: the palette\'s Ctrl+K handler (src/ui/CommandPalette.tsx:128-136, PaletteHost.tsx) opens it whatever is open, so it stacks over the Add an item dialog and its typed text')
  await expect(page.getByRole('dialog', { name: 'Search or jump to' })).toBeHidden()
})

test("HW-29: palette: '%' and '_' list unrelated results, a name with a backslash cannot be found, extra spaces find nothing", async ({ browser }, info) => {
  const { page } = await pin(browser, info, 'admin')
  await land(page, '/today')
  const dialog = await openPalette(page)
  await expect(dialog).toBeVisible()
  const a = await paletteAsk(page, dialog, '%')
  const unrelated = a.options.filter(o => !o.includes('%') && !/^Add “/.test(o))
  test.fail(
    true,
    "HW-29: '%' or '_' alone (or any text with no a-z/0-9 word, Urdu too) lists every 'How do I…' recipe: searchRecipes returns all when no word is left (src/features/help/recipes.ts:153). Also: 'back\\slash' never finds 'Hunt Back\\slash …' because search_all's replace(t, '\\', '\\') is a no-op (supabase/migrations/0054_search_v2.sql:36-37), and '  srch   word  ' finds nothing (inner spaces are not collapsed)",
  )
  expect(unrelated).toEqual([])
})

test('HW-30: list sort (RFQ board, Orders) is lost on Back and on refresh', async ({ browser }, info) => {
  await rfq({ customer: await company(`Hunt HW30 ${T}`), items: [{ description: `Hunt hw30 gauge ${T}`, qty: 1 }], owner: 'admin' })
  const { page } = await pin(browser, info, 'admin')
  await land(page, '/rfqs?owner=all')
  const due = () => page.getByRole('columnheader', { name: /Due/ }).first()
  await due().getByRole('button').click()
  await expect(due()).toHaveAttribute('aria-sort', 'ascending')
  await page.reload()
  await page.locator('#main').waitFor()
  await settle(page)
  await expect(due()).toBeVisible()
  test.fail(true, 'HW-30: DataTable keeps the sort in component state (src/ui/DataTable.tsx:168), not in the address, so refresh and Back (which remount the list) drop it; the same on Orders')
  await expect(due()).toHaveAttribute('aria-sort', 'ascending')
})

test("HW-31: the RFQ board header 'need you / overdue' counts everyone's RFQs while Mine is selected", async ({ browser }, info) => {
  // One RFQ of the salesperson's (so Mine has a list) and one owned by the admin that needs suppliers: in All, not in Mine.
  await rfq({ customer: await company(`Hunt HW31 mine ${T}`), items: [{ description: `Hunt hw31 own gauge ${T}`, qty: 1 }], owner: 'sales' })
  await rfq({ customer: await company(`Hunt HW31 ${T}`), items: [{ description: `Hunt hw31 gauge ${T}`, qty: 1 }], owner: 'admin' })
  const { page } = await pin(browser, info, 'sales')
  const lede = async () => (await mainText(page)).split('New RFQ')[0]
  const need = (t: string) => Number(/(\d+) need you/.exec(t)?.[1] ?? 0)
  const showing = (t: string) => Number(/Showing (\d+) of/.exec(t)?.[1] ?? NaN)
  await land(page, '/rfqs?owner=mine')
  const mine = await lede()
  const mineShown = showing(await mainText(page))
  await land(page, '/rfqs?owner=all')
  const all = await lede()
  const allShown = showing(await mainText(page))
  expect(mineShown).toBeLessThan(allShown)
  expect(need(all)).toBeGreaterThan(0)
  test.fail(true, `HW-31: the lede's "need you" and "overdue" are counted over open.data, every owner's RFQs (src/features/rfqs/board/BoardPage.tsx:107-112), so Mine shows "${mine.trim()}" exactly like All`)
  expect(need(mine)).toBeLessThan(need(all))
})

test("HW-32: the Orders page's 'need you' and the Orders nav badge count different things", async ({ browser }, info) => {
  const { page } = await pin(browser, info, 'sales')
  const read = async () => {
    await land(page, '/orders')
    const n = Number(/(\d+) need you/.exec(await mainText(page))?.[1] ?? 0)
    const nav = (await todayNumbers(page)).nav
    return { page: n, badge: nav.Orders ?? 0 }
  }
  const before = await read()
  // An order of the salesperson's whose payment is 15 days overdue: the Orders page's next step is "Chase payment".
  const o = await order({ lines: [{ description: `Hunt hw32 service visit ${T}`, qty: 1, price: 100000, service: true }], owner: 'sales', terms: 30, orderedOn: karachiDay(-50) })
  await post('invoices', { order_id: o.order.id, company_id: o.customer.id, number: `HW32-${TU}`, invoice_date: karachiDay(-45), net_amount: 100000, gst_amount: 18000 })
  const after = await read()
  void before
  expect(after.page).toBeGreaterThan(0)
  test.fail(true, 'HW-32: the Orders page counts late/now next steps of its rows (OrdersListPage.tsx lede, including chase payment and create invoice), while the Orders badge counts Today items in the orders section (useNavCounts + NAV_SECTION puts payment_overdue under Money), so the two disagree ("7 need you" vs badge 1 in run 1)')
  expect(after.badge, `Orders badge vs the Orders page's "${after.page} need you"`).toBe(after.page)
})

test("HW-33: near-duplicate company names are accepted ('A  B' with doubled spaces, a trailing full stop)", async ({ browser }, info) => {
  const base = await company(`Hunt HW33 ${T} Traders`)
  const variant = base.name.replace(/ /g, '  ')
  const { page } = await pin(browser, info, 'admin')
  await land(page, '/companies')
  await page.getByRole('button', { name: 'New company' }).first().click()
  const d = page.getByRole('dialog', { name: 'New company' })
  await d.getByRole('textbox', { name: /Company name/ }).fill(variant)
  await expect(d.getByRole('textbox', { name: /Company name/ })).toHaveValue(variant)
  await d.getByRole('button', { name: 'Add company' }).click()
  test.fail(true, 'HW-33: the unique index is lower(btrim(name)) (supabase/migrations/0006_companies.sql:22) and the client check compares trim/lower only, so doubled inner spaces or a trailing full stop make a second company')
  await expect(d.getByText(/already exists/)).toBeVisible({ timeout: 8_000 })
})

test('HW-34: desktop Back with Edit company open leaves the page and drops the typed notes without asking', async ({ browser }, info) => {
  // On a phone Back asks first (Dialog's useBackToClose with the dirty guard), which is right; this pins the desktop only.
  const co = await company(`Hunt HW34 ${T}`)
  const { page } = await pin(browser, info, 'sales')
  await land(page, '/companies')
  await land(page, `/companies/${co.id}`)
  await moreMenu(page).click()
  await page.getByRole('menuitem', { name: 'Edit company' }).click()
  const d = page.getByRole('dialog', { name: 'Edit company' })
  await d.getByLabel('Notes').fill(`Unsaved words ${T}`)
  await expect(d.getByLabel('Notes')).toHaveValue(`Unsaved words ${T}`)
  await page.goBack()
  await page.waitForTimeout(800)
  test.fail(true, 'HW-34: useBackToClose is enabled only for touch / under 768 px (src/ui/Dialog.tsx:101-106), so desktop Back navigates away under a dirty dialog with no "discard?" question')
  await expect(page).toHaveURL(new RegExp(`/companies/${co.id}$`))
})

test('HW-35: refresh drops the New company dialog (?new=1)', async ({ browser }, info) => {
  const name = `Hunt HW35 ${T}`
  const { page } = await pin(browser, info, 'sales')
  await land(page, `/companies?new=1&name=${encodeURIComponent(name)}`)
  const d = page.getByRole('dialog', { name: 'New company' })
  await expect(d).toBeVisible()
  await page.reload()
  await page.locator('#main').waitFor()
  await settle(page)
  test.fail(true, 'HW-35: CompaniesPage opens the dialog once and then removes new=1 from the address (src/features/companies/CompaniesPage.tsx:56-64), so a refresh (or a phone reloading the tab) loses the dialog')
  await expect(d).toBeVisible()
})

test('HW-36: the RFQ board table header scrolls away (not sticky) in a long list', async ({ browser }, info) => {
  const L = tag(6)
  const co = await post<{ id: string }>('companies', { name: `Hunt HW36 ${L} Sticky` })
  await postMany('rfqs', Array.from({ length: 40 }, (_, i) => ({ company_id: co.id, owner_id: USER.admin, due_on: karachiDay(i % 10), customer_ref: `HW36-${L}-${i}` })))
  const { page } = await pin(browser, info, 'admin')
  await land(page, `/rfqs?owner=all&q=${L}`)
  await expect(page.getByText(/Showing 40 of/)).toBeVisible()
  const geo = await page.evaluate(() => {
    const main = document.getElementById('main') as HTMLElement
    main.scrollTop = 1200
    const th = document.querySelector('#main table thead th') as HTMLElement
    return { scrolled: main.scrollTop, mainTop: main.getBoundingClientRect().top, thTop: th.getBoundingClientRect().top }
  })
  expect(geo.scrolled).toBeGreaterThan(1000)
  test.fail(true, 'HW-36: the th is sticky top-0 inside DataTable\'s overflow-auto wrapper (src/ui/DataTable.tsx:710-716,767), which only scrolls itself in virtual mode (over 80 rows); below that #main scrolls and the header goes with the rows')
  expect(geo.thTop).toBeGreaterThanOrEqual(geo.mainTop - 2)
})

test('HW-37: the palette offers to add a 300-character text as a new company', async ({ browser }, info) => {
  const { page } = await pin(browser, info, 'admin')
  await land(page, '/today')
  const dialog = await openPalette(page)
  await expect(dialog).toBeVisible()
  const a = await paletteAsk(page, dialog, 'x'.repeat(300))
  test.fail(true, 'HW-37: search_all ignores input over 100 characters (0054_search_v2.sql:48) and the palette then always adds "Add “…” as a new company" (src/features/search/paletteSource.ts:96-98), whatever the length')
  expect(a.options.filter(o => /^Add “/.test(o))).toEqual([])
})

test('HW-38: closing the palette with Escape leaves focus on <body>', async ({ browser }, info) => {
  const { page } = await pin(browser, info, 'admin')
  await land(page, '/today')
  await page.waitForTimeout(1500) // the palette's own Ctrl+K handler is loaded on idle
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Search or jump to' })
  await expect(dialog).toBeVisible()
  await paletteAsk(page, dialog, 'gauge')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  test.fail(true, 'HW-38: the palette returns focus to the element focused when it opened (src/ui/CommandPalette.tsx:248,254); opened with Ctrl+K from the page, there is none, so keyboard users restart from the top of the page')
  expect(await page.evaluate(() => document.activeElement?.tagName ?? 'none')).not.toBe('BODY')
})
