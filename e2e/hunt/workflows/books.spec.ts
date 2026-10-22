import { readFileSync } from 'node:fs'
import { expect, test, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test'
import { API_URL, ANON_KEY, karachiDay, login } from '../../support/stack'
import { db, USER } from '../../verify/support/db'
import { monthBefore, monthOf, order, payment, post } from '../../verify/support/fixtures'
import { blankCtx, ctxAs, layout, note, probe, settle, shot, tag, visit, watch } from './support'

/*
 * Hunt (workflows): the admin's books and settings, at 1366x768 and 375x812 (touch). Everything is recorded, nothing stops the run.
 *
 *  1. Expense entry       Add expense with a category CREATED from the dialog's combobox (appears, saved, active, filed under
 *                         Overheads, paid via as tapped, last in the order), a name that only differs in case, a 61-character name,
 *                         a name another admin created after the dialog opened (race), receipt photo, double-click Save, Back
 *                         with the dialog open, reload mid-form, recurring (add, junk "Starts in", double-click Record), the burst
 *                         sheet with an inline category on desktop (cash) and phone (bank, two rows, camera photo).
 *  2. In vs out and the   Payments and expenses seeded across three months through REST; In vs out for the previous MONTH and the
 *     reports             current QUARTER read before and after: the change on screen must equal the hand total, and every figure
 *                         must equal v_month_cash_flow; the previous-quarter column; the category/detail table; CSV export parsed
 *                         and compared with the database to the paisa; the P&L Overheads line moves by the hand total; every
 *                         month report (P&L, categories, aging, owe, GST, team, margins) and /reports at desktop and phone, with
 *                         their CSVs parsed.
 *  3. Close and reopen    Two admins: one has Add expense open dated in last month, the other closes the month (double-click on
 *                         the confirm), then the first saves (must be the plain closed-month sentence, nothing saved); a third,
 *                         stale Month-end page closes again; Record payment and Create invoice dated in the closed month; In vs out
 *                         and P&L frozen; reopen from the UI; the refused form's Try again then saves. Every month this test
 *                         closed is reopened in a finally.
 *  4. Team                Add person through the admin-users function (validation, double-click Create account), the new person
 *                         signs in through /login on a phone and works; deactivated WHILE their session is open (next navigation
 *                         and next save); sign-in refused; reactivated; role sales -> engineer while signed in (does the open
 *                         session lose Money?); password reset while signed in (the dialog promises "signed out on every
 *                         device"); change password (wrong current, mismatch, too short, then a real change). The person is
 *                         deactivated again at the end.
 *  5. Settings            Company profile (empty legal name, junk NTN, validity 0 / text, negative terms, double-click Save, Back
 *                         and reload with unsaved changes), exchange rates (zero, negative, huge, future-dated), targets grid
 *                         (text and negative in a cell that holds a target), categories (rename to a duplicate, delete in use,
 *                         Enter twice on Add), my details (phone too long), change password as the admin (wrong current,
 *                         mismatch, short: nothing changes); every settings screen on a phone; sales and engineer on the admin
 *                         screens by URL and through the Ctrl+K palette.
 * Fixture data only (@test.invalid people, made-up companies). Everything this file changes is put back in a finally.
 */

const RENT = 'ca7e0000-0000-4000-8000-000000000002'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DwnwEJMDEgAVwcAEVXAgJQ6mHVAAAAAElFTkSuQmCC', 'base64')
const TODAY = karachiDay(0)
const M0 = monthOf(TODAY)
const M1 = monthBefore(TODAY, 1)
const M2 = monthBefore(TODAY, 2)
const T = tag(6)
const rnd = () => 1000 + Math.floor(Math.random() * 8000)

// ------------------------------------------------------------------------------------------------ small helpers

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const typed = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** The last number in a text ("PKR 1,234,567", "−4,321", "before 12"). */
function toNum(t: string): number {
  const m = t.replace(/−/g, '-').match(/-?\d[\d,]*(\.\d+)?/g)
  return m ? Number(m[m.length - 1].replace(/,/g, '')) : NaN
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"'
          i++
        } else q = false
      } else cur += c
    } else if (c === '"') q = true
    else if (c === ',') {
      row.push(cur)
      cur = ''
    } else if (c === '\n') {
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
    } else if (c !== '\r') cur += c
  }
  if (cur !== '' || row.length) {
    row.push(cur)
    rows.push(row)
  }
  return rows
}

async function exportCsv(page: Page, scope: Locator = page.locator('#main')): Promise<{ name: string; rows: string[][] }> {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), scope.getByRole('button', { name: 'Export CSV' }).first().click()])
  const p = await d.path()
  return { name: d.suggestedFilename(), rows: parseCsv(readFileSync(p, 'utf8')) }
}

async function within(ms: number, cond: () => Promise<boolean>): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await cond().catch(() => false)) return true
    await sleep(500)
  }
  return false
}

function same(info: TestInfo, where: string, what: string, screen: number, expected: number, tol = 1): void {
  if (!(Math.abs(screen - expected) <= tol)) note(info, { kind: 'observation', where, what: `${what}: the screen shows ${screen}, expected ${expected}` })
}

async function open(ctx: BrowserContext, info: TestInfo, path: string, label: string, allowStatus: number[] = []): Promise<Page> {
  const page = await ctx.newPage()
  watch(page, info, label, { allowStatus })
  await visit(page, info, path, label)
  return page
}

/** A client-side route change (no reload): what clicking a link does. */
async function spaGo(page: Page, path: string): Promise<void> {
  await page.evaluate(p => {
    window.history.pushState({}, '', p)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await settle(page)
}

async function refused(page: Page): Promise<boolean> {
  const t = await page.locator('#main').innerText({ timeout: 5_000 }).catch(() => '')
  return /\bis for (admins|sales|engineers)|has no access yet|not available to your role/i.test(t)
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await within(15_000, async () => !new URL(page.url()).pathname.startsWith('/login') || (await page.getByRole('alert').count()) > 0 || (await page.getByText(/deactivated|incorrect/i).count()) > 0)
}

const signedInApp = async (page: Page) => !new URL(page.url()).pathname.startsWith('/login') && (await page.locator('#main').count()) > 0

async function closedMonths(): Promise<string[]> {
  return (await db.rows<{ month: string }>('closed_months?select=month')).map(r => r.month)
}
/** Reopen every month closed since `before`, latest first. */
async function reopenSince(before: string[]): Promise<void> {
  const now = await closedMonths()
  for (const m of now.filter(x => !before.includes(x)).sort().reverse()) await db.adminRpc('reopen_month', { p_month: m, p_note: 'hunt books cleanup' })
}

/** The admin-users Edge Function as the admin fixture user (cleanup only). */
async function adminUsers(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const s = await login('admin')
  const r = await fetch(`${API_URL}/functions/v1/admin-users`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, authorization: `Bearer ${s.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: r.status, json: (await r.json().catch(() => null)) as Record<string, unknown> | null }
}

const qKey = (month: string) => `${month.slice(0, 4)}-Q${Math.ceil(Number(month.slice(5, 7)) / 3)}`
function qMonths(q: string): string[] {
  const y = q.slice(0, 4)
  const f = (Number(q.slice(6)) - 1) * 3 + 1
  return [0, 1, 2].map(i => `${y}-${String(f + i).padStart(2, '0')}`)
}
function prevQ(q: string): string {
  let y = Number(q.slice(0, 4))
  let n = Number(q.slice(6)) - 1
  if (n === 0) {
    n = 4
    y--
  }
  return `${y}-Q${n}`
}

type Flow = { month: string; money_in: number | string; money_out: number | string; frozen: boolean }
const flows = () => db.view<Flow>('v_month_cash_flow?select=month,money_in,money_out,frozen')
const sumFlow = (rows: Flow[], months: string[], f: 'money_in' | 'money_out') => rows.filter(r => months.includes(r.month.slice(0, 7))).reduce((s, r) => s + Number(r[f]), 0)

interface InOut {
  in: number
  out: number
  net: number
  beforeIn: number
  beforeOut: number
  frozen: boolean
}
async function readInOut(page: Page, info: TestInfo, url: string): Promise<InOut> {
  await visit(page, info, url, 'in-out')
  await page.getByTestId('cash-in').waitFor({ timeout: 15_000 })
  const cell = async (id: string, i: number) => toNum(await page.getByTestId(id).getByRole('cell').nth(i).innerText())
  return {
    in: await cell('cash-in', 0),
    out: await cell('cash-out', 0),
    net: await cell('cash-net', 0),
    beforeIn: await cell('cash-in', 1),
    beforeOut: await cell('cash-out', 1),
    frozen: (await page.getByTestId('in-out-frozen').count()) > 0,
  }
}

/** The P&L Overheads line (as a positive number), 0 when the month is empty. */
async function pnlOverheads(page: Page, info: TestInfo, month: string): Promise<number> {
  await visit(page, info, `/money/reports/pnl?month=${month}`, 'pnl')
  const table = page.getByRole('table', { name: 'Profit and loss' })
  if (!(await table.isVisible().catch(() => false))) return 0
  const row = table.getByRole('row').filter({ hasText: /^\s*Overheads/ }).first()
  return Math.abs(toNum(await row.getByRole('cell').last().innerText()))
}

test.describe.configure({ mode: 'serial' })

// ================================================================================================ 1. expense entry

test('books: Add expense with a category made inline, the burst sheet, recurring and receipts (desktop and phone)', async ({ browser }, info) => {
  test.setTimeout(240_000)
  const ctx = await ctxAs(browser, info, 'admin', 'desktop')
  const page = await open(ctx, info, '/money/expenses', 'admin/desktop expenses', [409])
  const cat = `Hunt Water ${T}`
  const amtA = 70000 + rnd()
  const descA = `hunt inline ${T}`

  await probe(info, page, 'dialog: create a category from the combobox, receipt, double-click Save', async () => {
    await visit(page, info, '/money/expenses?add=1', 'expense dialog')
    const d = page.getByRole('dialog', { name: 'Add expense' })
    await d.getByRole('textbox', { name: 'Amount, PKR' }).fill(String(amtA), { timeout: 10_000 })
    const combo = d.getByRole('combobox', { name: 'Category' })
    await combo.fill(cat)
    await page.getByRole('option', { name: new RegExp(`Create “${esc(cat)}”.*paid by bank`) }).click({ timeout: 10_000 })
    if (!(await within(10_000, async () => (await combo.inputValue()) === cat)))
      note(info, { kind: 'observation', where: 'inline category', what: `after Create the Category box shows "${await combo.inputValue()}", not the new name` })
    if ((await d.getByText(/Paid via\s*Bank/).count()) === 0)
      note(info, { kind: 'observation', where: 'inline category', what: 'created "paid by bank" but the dialog does not say Paid via Bank', detail: await d.innerText() })
    await d.getByRole('button', { name: 'Add a detail' }).click()
    await d.getByRole('combobox', { name: 'Detail' }).fill(descA)
    await d.locator('input[type=file]').first().setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG })
    await layout(page, info, 'expense dialog with inline category')
    await shot(page, 'books-dialog-inline-category')
    await d.getByRole('button', { name: 'Save expense' }).dblclick()
    await d.waitFor({ state: 'hidden', timeout: 15_000 })
    await sleep(1500)
    const rows = await db.rows<{ id: string; category_id: string; paid_via: string }>(`expenses?description=eq.${encodeURIComponent(descA)}&select=id,category_id,paid_via`)
    if (rows.length !== 1) note(info, { kind: 'observation', where: 'double-click Save expense', what: `${rows.length} expenses saved for one double-click` })
    const cats = await db.rows<{ id: string; grp: string; default_paid_via: string; active: boolean; sort: number }>(`expense_categories?name=eq.${encodeURIComponent(cat)}&select=id,grp,default_paid_via,active,sort`)
    if (cats.length !== 1) throw new Error(`${cats.length} categories named ${cat}`)
    const c = cats[0]
    if (c.grp !== 'overhead' || c.default_paid_via !== 'bank' || !c.active) note(info, { kind: 'observation', where: 'inline category', what: 'the new category is not overhead/bank/active', detail: c })
    const maxSort = Math.max(...(await db.rows<{ sort: number }>('expense_categories?select=sort')).map(r => r.sort))
    if (c.sort !== maxSort) note(info, { kind: 'observation', where: 'inline category', what: `the new category is not last (sort ${c.sort}, max ${maxSort})` })
    if (rows[0] && (rows[0].category_id !== c.id || rows[0].paid_via !== 'bank')) note(info, { kind: 'observation', where: 'inline category', what: 'the expense was not saved with the new category / bank', detail: rows[0] })
    if (rows[0]) {
      const ok = await within(10_000, async () => (await db.rows(`attachments?expense_id=eq.${rows[0].id}&select=id`)).length === 1)
      if (!ok) note(info, { kind: 'observation', where: 'dialog receipt', what: 'the receipt photo chosen in the Add expense dialog was not recorded' })
    }
  })

  await probe(info, page, 'the inline category shows in Settings > Expense categories, grouped, with 1 use', async () => {
    await visit(page, info, '/settings/categories', 'categories')
    const row = page.locator(`[data-category="${cat}"]`)
    await row.waitFor({ timeout: 10_000 })
    const grp = await row.getByLabel(`Group of ${cat}`).inputValue()
    const usage = await row.getByTestId('usage').innerText()
    if (grp !== 'overhead' || !/1 use/.test(usage)) note(info, { kind: 'observation', where: 'categories', what: `inline category shows group ${grp}, usage "${usage}"` })
  })

  await probe(info, page, 'dialog: a name differing only in case, a 61-char name, and a name made elsewhere after the dialog opened', async () => {
    await visit(page, info, '/money/expenses?add=1', 'expense dialog 2')
    const d = page.getByRole('dialog', { name: 'Add expense' })
    const combo = d.getByRole('combobox', { name: 'Category' })
    await combo.fill('  rENT  ', { timeout: 10_000 })
    await sleep(300)
    if ((await page.getByRole('option', { name: /^Create/ }).count()) > 0) note(info, { kind: 'observation', where: 'inline category', what: 'offers to create "  rENT  " although Rent exists' })
    await combo.fill('X'.repeat(61))
    await page.getByRole('option', { name: /^Create/ }).first().click({ timeout: 5_000 })
    const long = await page.getByText('Keep the name to 60 characters or fewer.').isVisible({ timeout: 5_000 }).catch(() => false)
    if (!long) note(info, { kind: 'observation', where: 'inline category', what: 'a 61-character name gave no "60 characters" sentence', detail: await page.getByRole('listbox', { name: 'Categories' }).innerText().catch(() => '') })
    // another admin makes the same name now; this dialog's list does not know it yet
    const race = `Hunt Race ${T}`
    await post('expense_categories', { name: race, grp: 'overhead', default_paid_via: 'cash', sort: 990 })
    await combo.fill(race)
    const create = page.getByRole('option', { name: new RegExp(`Create “${esc(race)}”`) }).first()
    if (await create.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await create.click()
      await sleep(2000)
      const said = await page.getByRole('listbox', { name: 'Categories' }).innerText().catch(() => '')
      const val = await combo.inputValue()
      note(info, { kind: 'observation', where: 'inline category race', what: `creating a name another admin just made: box "${val}", list says: ${said.replace(/\s+/g, ' ').slice(0, 200)}` })
      if (!/already exists/i.test(said) && val !== race) note(info, { kind: 'observation', where: 'inline category race', what: 'no plain "already exists" sentence after a unique clash' })
    }
    const n = (await db.rows(`expense_categories?name=ilike.${encodeURIComponent(race)}&select=id`)).length
    if (n !== 1) note(info, { kind: 'observation', where: 'inline category race', what: `${n} categories named ${race}` })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
  })

  await probe(info, page, 'Back with the dialog open, then Forward', async () => {
    await visit(page, info, '/money/expenses', 'expenses list')
    await page.goto('/money/expenses?add=1')
    const d = page.getByRole('dialog', { name: 'Add expense' })
    await d.getByRole('textbox', { name: 'Amount, PKR' }).fill('4321', { timeout: 10_000 })
    await page.goBack()
    await settle(page)
    const afterBack = { url: page.url(), dialog: await d.isVisible().catch(() => false) }
    await page.goForward()
    await settle(page)
    const afterFwd = { url: page.url(), dialog: await d.isVisible().catch(() => false), amount: await d.getByRole('textbox', { name: 'Amount, PKR' }).inputValue().catch(() => null) }
    note(info, { kind: 'observation', where: 'Back with Add expense open', what: `after Back: ${JSON.stringify(afterBack)}; after Forward: ${JSON.stringify(afterFwd)}` })
    await shot(page, 'books-dialog-after-back-forward')
    await page.keyboard.press('Escape')
  })

  await probe(info, page, 'reload with Add expense half filled', async () => {
    await visit(page, info, '/money/expenses?add=1', 'expense dialog reload')
    const d = page.getByRole('dialog', { name: 'Add expense' })
    await d.getByRole('textbox', { name: 'Amount, PKR' }).fill('8765', { timeout: 10_000 })
    await page.reload()
    await settle(page)
    const amount = await page.getByRole('dialog', { name: 'Add expense' }).getByRole('textbox', { name: 'Amount, PKR' }).inputValue({ timeout: 5_000 }).catch(() => null)
    note(info, { kind: 'observation', where: 'reload mid-form', what: `after reload the dialog ${amount === null ? 'is gone' : `is open, amount "${amount}"`} (typed 8765, nothing warned before the reload)` })
    await page.keyboard.press('Escape')
  })

  const rec = `Hunt Internet ${T}`
  await probe(info, page, 'recurring: junk "Starts in", then add one and double-click Record', async () => {
    await visit(page, info, '/money/expenses', 'recurring')
    await page.getByRole('button', { name: 'Add recurring' }).click({ timeout: 10_000 })
    const d = page.getByRole('dialog', { name: 'Add recurring expense' })
    await d.getByRole('textbox', { name: 'Name' }).fill(rec)
    await d.getByRole('combobox', { name: 'Category' }).fill('Rent')
    await page.keyboard.press('Enter')
    await d.getByRole('textbox', { name: 'Amount, PKR' }).fill('12,345')
    await d.getByRole('textbox', { name: 'Starts in' }).fill('abc')
    await d.getByRole('button', { name: 'Save', exact: true }).click()
    await sleep(1500)
    if (await d.isVisible()) note(info, { kind: 'observation', where: 'recurring', what: `"Starts in" = abc: the dialog says ${(await d.innerText()).replace(/\s+/g, ' ').slice(0, 300)}` })
    else note(info, { kind: 'observation', where: 'recurring', what: '"Starts in" = abc was accepted and saved', detail: await db.rows(`recurring_expenses?label=eq.${encodeURIComponent(rec)}&select=*`) })
    if (await d.isVisible()) {
      await d.getByRole('textbox', { name: 'Starts in' }).fill('')
      await d.getByRole('button', { name: /^(Save|Try again)$/ }).click()
      await d.waitFor({ state: 'hidden', timeout: 10_000 })
    }
    const item = page.getByTestId(`recurring-${rec}`)
    await item.getByRole('button', { name: `Record ${rec}` }).dblclick({ timeout: 10_000 })
    await sleep(2500)
    const [tpl] = await db.rows<{ id: string }>(`recurring_expenses?label=eq.${encodeURIComponent(rec)}&select=id`)
    const n = (await db.rows(`expenses?recurring_id=eq.${tpl.id}&select=id`)).length
    if (n !== 1) note(info, { kind: 'observation', where: 'recurring double-click Record', what: `${n} expenses recorded for one double-click` })
    await shot(page, 'books-recurring-recorded')
  })

  const cat2 = `Hunt Parking ${T}`
  const amtB = 60000 + rnd()
  await probe(info, page, 'burst sheet (desktop): inline category, paid in cash, Ctrl+Enter', async () => {
    await visit(page, info, '/money/expenses', 'burst desktop')
    await page.getByRole('button', { name: 'Add expenses' }).click({ timeout: 10_000 })
    const amount = page.getByRole('textbox', { name: 'Amount, row 1' })
    await amount.waitFor({ timeout: 10_000 })
    await amount.fill(String(amtB))
    const combo = page.getByRole('combobox', { name: 'Category, row 1' })
    await combo.fill(cat2)
    await page.getByRole('option', { name: new RegExp(`Create “${esc(cat2)}”.*paid in cash`) }).click({ timeout: 10_000 })
    if ((await combo.inputValue()) !== cat2) note(info, { kind: 'observation', where: 'burst inline category', what: `the cell shows "${await combo.inputValue()}" after Create` })
    await layout(page, info, 'burst desktop')
    await shot(page, 'books-burst-desktop-inline')
    await amount.focus()
    await page.keyboard.press('Control+Enter')
    await page.getByRole('dialog').first().waitFor({ state: 'hidden', timeout: 15_000 })
    const [row] = await db.rows<{ paid_via: string; category_id: string }>(`expenses?amount_pkr=eq.${amtB}&select=paid_via,category_id`)
    const [c] = await db.rows<{ id: string }>(`expense_categories?name=eq.${encodeURIComponent(cat2)}&select=id`)
    if (!row || !c || row.category_id !== c.id || row.paid_via !== 'cash') note(info, { kind: 'observation', where: 'burst inline category', what: 'not saved with the new category paid in cash', detail: { row, c } })
  })
  await ctx.close()

  const phone = await ctxAs(browser, info, 'admin', 'phone')
  const pp = await open(phone, info, '/money/expenses', 'admin/phone expenses', [409])
  const cat3 = `Hunt Courier ${T}`
  const [p1, p2] = [50000 + rnd(), 40000 + rnd()]
  await probe(info, pp, 'burst sheet (phone): inline category paid by bank, a second row with a camera photo', async () => {
    await layout(pp, info, 'expenses phone')
    await shot(pp, 'books-expenses-phone')
    await pp.getByRole('button', { name: 'Add expenses' }).click({ timeout: 10_000 })
    await pp.getByRole('textbox', { name: 'Amount, expense 1' }).fill(String(p1), { timeout: 10_000 })
    await pp.getByRole('combobox', { name: 'Category, expense 1' }).fill(cat3)
    await pp.getByRole('option', { name: new RegExp(`Create “${esc(cat3)}”.*paid by bank`) }).click({ timeout: 10_000 })
    const chip = await pp.getByRole('button', { name: /^Paid via, expense 1: Bank/ }).isVisible({ timeout: 5_000 }).catch(() => false)
    if (!chip) note(info, { kind: 'observation', where: 'phone burst inline category', what: 'created "paid by bank" but the chip does not say Bank' })
    await pp.getByRole('button', { name: 'Add a row' }).click()
    await pp.getByRole('textbox', { name: 'Amount, expense 2' }).fill(String(p2))
    await pp.locator('input[type=file][capture]').nth(1).setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG })
    await layout(pp, info, 'burst phone two rows')
    await shot(pp, 'books-burst-phone-two-rows')
    await pp.getByRole('button', { name: /^Save 2 expenses/ }).click()
    await pp.getByRole('dialog').first().waitFor({ state: 'hidden', timeout: 15_000 })
    const r1 = await db.rows<{ id: string; paid_via: string }>(`expenses?amount_pkr=eq.${p1}&select=id,paid_via`)
    const r2 = await db.rows<{ id: string }>(`expenses?amount_pkr=eq.${p2}&select=id`)
    if (r1.length !== 1 || r1[0].paid_via !== 'bank' || r2.length !== 1) note(info, { kind: 'observation', where: 'phone burst', what: 'rows not saved as entered', detail: { r1, r2 } })
    if (r2[0]) {
      const ok = await within(10_000, async () => (await db.rows(`attachments?expense_id=eq.${r2[0].id}&select=id`)).length === 1)
      if (!ok) note(info, { kind: 'observation', where: 'phone burst', what: 'the camera photo on row 2 was not recorded' })
    }
  })
  await probe(info, pp, 'phone: the one-expense dialog', async () => {
    await visit(pp, info, '/money/expenses?add=1', 'expense dialog phone')
    await pp.getByRole('dialog', { name: 'Add expense' }).waitFor({ timeout: 10_000 })
    await layout(pp, info, 'expense dialog phone')
    await shot(pp, 'books-dialog-phone')
  })
  await phone.close()
})

// ================================================================================================ 2. in vs out and the reports

test('books: In vs out for a month and a quarter equals the hand totals and the database; the reports and their CSVs', async ({ browser }, info) => {
  test.setTimeout(300_000)
  const ctx = await ctxAs(browser, info, 'admin', 'desktop')
  const page = await open(ctx, info, '/money/reports', 'admin/desktop reports')
  const Q0 = qKey(M0.key)
  const q0Months = qMonths(Q0)
  const monthUrl = (m: string) => `/money/reports/in-out?by=month&period=${m}`
  const quarterUrl = (q: string) => `/money/reports/in-out?by=quarter&period=${q}`
  const detail = `hunt in-out ${T}`

  const closedNow = await closedMonths()
  if ([M0.start, M1.start, M2.start].some(m => closedNow.includes(m))) note(info, { kind: 'observation', where: 'in-out setup', what: `a month in the seed range is closed already: ${closedNow.join(', ')}` })

  let m1Before: InOut | null = null
  let q0Before: InOut | null = null
  let ovBefore = 0
  await probe(info, page, 'in-out: read the month and the quarter before seeding', async () => {
    m1Before = await readInOut(page, info, monthUrl(M1.key))
    q0Before = await readInOut(page, info, quarterUrl(Q0))
    ovBefore = await pnlOverheads(page, info, M1.key)
  })

  // Hand totals: P1 150,000 in M1; P2 20,000 in M0; E1 4,321 + E4 10.50 in M1 (Rent, bank); E2 999 in M2; E3 2,000 in M0 (cash).
  const seeds = {
    pay: [
      { amount: 150000, on: M1.day(10) },
      { amount: 20000, on: M0.day(1) },
    ],
    exp: [
      { amount: 4321, on: M1.day(12), via: 'bank' },
      { amount: 10.5, on: M1.day(13), via: 'bank' },
      { amount: 999, on: M2.day(15), via: 'bank' },
      { amount: 2000, on: M0.day(1), via: 'cash' },
    ],
  }
  const handIn = (months: string[]) => seeds.pay.filter(p => months.includes(p.on.slice(0, 7))).reduce((s, p) => s + p.amount, 0)
  const handOut = (months: string[]) => seeds.exp.filter(e => months.includes(e.on.slice(0, 7))).reduce((s, e) => s + e.amount, 0)

  const seeded = await probe(info, null, 'in-out: seed payments and expenses across three months', async () => {
    const o = await order({ lines: [{ description: `Hunt books flow meter ${T}`, qty: 1, price: 200000 }], orderedOn: M2.day(1) })
    for (const p of seeds.pay) await payment(o.order.id, p.amount, p.on, 'bank')
    for (const e of seeds.exp) await post('expenses', { amount_pkr: e.amount, category_id: RENT, paid_on: e.on, paid_via: e.via, description: detail })
  })

  await probe(info, page, 'in-out MONTH: the change on screen equals the hand total, and every figure equals the database', async () => {
    if (!seeded || !m1Before) throw new Error('no seed or no before figures')
    const after = await readInOut(page, info, monthUrl(M1.key))
    const b = m1Before as InOut
    same(info, `in-out ${M1.key}`, 'money in moved by', after.in - b.in, handIn([M1.key]))
    same(info, `in-out ${M1.key}`, 'money out moved by', after.out - b.out, handOut([M1.key]))
    const f = await flows()
    same(info, `in-out ${M1.key}`, 'money in vs v_month_cash_flow', after.in, sumFlow(f, [M1.key], 'money_in'))
    same(info, `in-out ${M1.key}`, 'money out vs v_month_cash_flow', after.out, sumFlow(f, [M1.key], 'money_out'))
    same(info, `in-out ${M1.key}`, 'cash net = in - out', after.net, after.in - after.out)
    same(info, `in-out ${M1.key}`, 'previous month in vs database', after.beforeIn, sumFlow(f, [M2.key], 'money_in'))
    same(info, `in-out ${M1.key}`, 'previous month out vs database', after.beforeOut, sumFlow(f, [M2.key], 'money_out'))
    const table = page.getByRole('table', { name: new RegExp(`^Money out by category, ${esc(M1.label)}`) })
    if (!(await table.getByText(detail).first().isVisible({ timeout: 5_000 }).catch(() => false)))
      note(info, { kind: 'observation', where: `in-out ${M1.key}`, what: `the detail "${detail}" is not under Money out by category` })
    await layout(page, info, 'in-out month desktop')
    await shot(page, `books-in-out-month-${M1.key}`)
  })

  await probe(info, page, 'in-out MONTH: CSV equals the database to the paisa', async () => {
    await readInOut(page, info, monthUrl(M1.key))
    const csv = await exportCsv(page)
    if (csv.name !== `in-vs-out-${M1.key}.csv`) note(info, { kind: 'observation', where: 'in-out csv', what: `file name ${csv.name}` })
    const f = await flows()
    const line = (re: RegExp) => csv.rows.find(r => r[0] === 'Cash' && re.test(r[2] ?? ''))
    const inn = line(/^Money in/)
    const out = line(/^Money out/)
    if (!inn || !out) throw new Error(`no Cash rows in the CSV: ${JSON.stringify(csv.rows.slice(0, 4))}`)
    same(info, 'in-out csv', 'CSV money in vs database', Number(inn[5]), sumFlow(f, [M1.key], 'money_in'), 0.005)
    same(info, 'in-out csv', 'CSV money out vs database', Number(out[5]), sumFlow(f, [M1.key], 'money_out'), 0.005)
    const det = csv.rows.find(r => r[0] === 'Money out by detail' && r[3] === detail)
    if (!det) note(info, { kind: 'observation', where: 'in-out csv', what: `no detail row for "${detail}"` })
    else same(info, 'in-out csv', 'CSV detail amount (4,321 + 10.50, details matched ignoring case)', Number(det[5]), 4331.5, 0.005)
    // a detail row that should equal the screen
    const screenOut = toNum(await page.getByTestId('cash-out').getByRole('cell').first().innerText())
    same(info, 'in-out csv', 'screen money out vs CSV (rounded to the rupee)', screenOut, Math.round(Number(out[5])))
  })

  await probe(info, page, 'in-out QUARTER: the change equals the hand total; previous quarter equals the database', async () => {
    if (!seeded || !q0Before) throw new Error('no seed or no before figures')
    const after = await readInOut(page, info, quarterUrl(Q0))
    const b = q0Before as InOut
    same(info, `in-out ${Q0}`, 'quarter money in moved by', after.in - b.in, handIn(q0Months))
    same(info, `in-out ${Q0}`, 'quarter money out moved by', after.out - b.out, handOut(q0Months))
    const f = await flows()
    same(info, `in-out ${Q0}`, 'quarter money in vs database', after.in, sumFlow(f, q0Months, 'money_in'))
    same(info, `in-out ${Q0}`, 'quarter money out vs database', after.out, sumFlow(f, q0Months, 'money_out'))
    same(info, `in-out ${Q0}`, 'previous quarter in vs database', after.beforeIn, sumFlow(f, qMonths(prevQ(Q0)), 'money_in'))
    same(info, `in-out ${Q0}`, 'previous quarter out vs database', after.beforeOut, sumFlow(f, qMonths(prevQ(Q0)), 'money_out'))
    const csv = await exportCsv(page)
    const inn = csv.rows.find(r => r[0] === 'Cash' && /^Money in/.test(r[2] ?? ''))
    if (inn) same(info, 'in-out quarter csv', 'CSV quarter money in vs database', Number(inn[5]), sumFlow(f, q0Months, 'money_in'), 0.005)
    const trend = page.getByRole('table', { name: 'The last 4 quarters' })
    if (!(await trend.isVisible({ timeout: 5_000 }).catch(() => false))) note(info, { kind: 'observation', where: `in-out ${Q0}`, what: 'no "The last 4 quarters" table' })
    await layout(page, info, 'in-out quarter desktop')
    await shot(page, `books-in-out-quarter-${Q0}`)
  })

  await probe(info, page, 'in-out: Month/Quarter switch, the Next arrow at now, a future period in the address', async () => {
    await visit(page, info, monthUrl(M0.key), 'in-out now')
    if (!(await page.getByRole('button', { name: 'Next month' }).isDisabled())) note(info, { kind: 'observation', where: 'in-out', what: 'Next month is enabled on the current month' })
    await page.getByRole('radio', { name: 'Quarter' }).click()
    await settle(page)
    if (!page.url().includes(`period=${Q0}`)) note(info, { kind: 'observation', where: 'in-out', what: `Quarter from ${M0.key} went to ${page.url()}` })
    await visit(page, info, '/money/reports/in-out?by=month&period=2099-01', 'in-out future')
    const shown = await page.getByRole('group', { name: 'Period' }).innerText()
    note(info, { kind: 'observation', where: 'in-out future period', what: `?period=2099-01 shows "${shown.replace(/\s+/g, ' ')}" (address still ${page.url()})` })
  })

  await probe(info, page, 'P&L: the Overheads line moves by the hand total (Rent, no input tax)', async () => {
    if (!seeded) throw new Error('no seed')
    const ov = await pnlOverheads(page, info, M1.key)
    same(info, `pnl ${M1.key}`, 'Overheads moved by', ov - ovBefore, 4331.5)
  })

  for (const k of ['pnl', 'categories', 'aging', 'owe', 'gst', 'team', 'margins']) {
    await probe(info, page, `report ${k} (desktop): renders, CSV parses`, async () => {
      await visit(page, info, `/money/reports/${k}?month=${M1.key}`, `report ${k}`)
      const crashed = (await page.getByText(/Something went wrong|did not load/i).count()) > 0
      if (crashed) note(info, { kind: 'observation', where: `report ${k}`, what: 'shows an error', detail: (await page.locator('#main').innerText()).slice(0, 300) })
      await layout(page, info, `report ${k} desktop`)
      await shot(page, `books-report-${k}-desktop`)
      if ((await page.getByRole('button', { name: 'Export CSV' }).count()) > 0) {
        const csv = await exportCsv(page)
        // A header-only CSV is right for an empty month; it is a finding only when the screen shows rows.
        const emptyOnScreen = (await page.getByText(/Nobody owes an invoice|Nothing is owed to suppliers|No invoices yet|Nobody is credited|No expenses|Nothing in |No payment was received/).count()) > 0
        if (csv.rows.length < 2 && !emptyOnScreen) note(info, { kind: 'observation', where: `report ${k} csv`, what: `${csv.name} has ${csv.rows.length} rows`, detail: csv.rows })
        const widths = new Set(csv.rows.filter(r => r.length > 1).map(r => r.length))
        if (widths.size > 1) note(info, { kind: 'observation', where: `report ${k} csv`, what: `${csv.name}: rows of different widths ${[...widths].join('/')}` })
        if (k === 'categories') {
          const rent = csv.rows.find(r => r.some(c => c === 'Rent'))
          if (!rent) note(info, { kind: 'observation', where: 'categories csv', what: 'no Rent row although Rent was paid in the month' })
        }
      }
    })
  }
  await probe(info, page, 'Reports list and /reports (desktop)', async () => {
    await visit(page, info, `/money/reports?month=${M1.key}`, 'money reports list')
    await layout(page, info, 'money reports list')
    await shot(page, 'books-money-reports-list')
    await visit(page, info, '/reports', 'sales reports')
    await layout(page, info, 'sales reports desktop')
    await shot(page, 'books-sales-reports-desktop')
  })
  await ctx.close()

  const phone = await ctxAs(browser, info, 'admin', 'phone')
  const pp = await open(phone, info, `/money/reports?month=${M1.key}`, 'admin/phone reports')
  await probe(info, pp, 'phone: reports list, in-out month and quarter', async () => {
    await layout(pp, info, 'reports list phone')
    await shot(pp, 'books-reports-list-phone')
    const m = await readInOut(pp, info, monthUrl(M1.key))
    const f = await flows()
    same(info, `phone in-out ${M1.key}`, 'money in vs database', m.in, sumFlow(f, [M1.key], 'money_in'))
    await layout(pp, info, 'in-out month phone')
    await shot(pp, 'books-in-out-month-phone')
    await readInOut(pp, info, quarterUrl(Q0))
    await layout(pp, info, 'in-out quarter phone')
    await shot(pp, 'books-in-out-quarter-phone')
  })
  for (const k of ['pnl', 'categories', 'aging', 'owe', 'gst', 'team', 'margins'])
    await probe(info, pp, `report ${k} (phone)`, async () => {
      await visit(pp, info, `/money/reports/${k}?month=${M1.key}`, `report ${k} phone`)
      await layout(pp, info, `report ${k} phone`)
      await shot(pp, `books-report-${k}-phone`)
    })
  await probe(info, pp, '/reports (phone)', async () => {
    await visit(pp, info, '/reports', 'sales reports phone')
    await layout(pp, info, 'sales reports phone')
    await shot(pp, 'books-sales-reports-phone')
  })
  await phone.close()
})

// ================================================================================================ 3. close and reopen

test('books: two admins, one closes last month while the other has Add expense open dated in it; refusals; frozen reports; reopen', async ({ browser }, info) => {
  test.setTimeout(240_000)
  const before = await closedMonths()
  const amtC = 30000 + rnd()
  const descC = `hunt closed ${T}`
  const sentence = `${M1.label} is closed. An admin can reopen it.`
  const ctxA = await ctxAs(browser, info, 'admin', 'desktop')
  const ctxB = await ctxAs(browser, info, 'admin', 'phone')
  const ctxC = await ctxAs(browser, info, 'admin', 'desktop')
  try {
    if (before.includes(M1.start)) note(info, { kind: 'observation', where: 'close setup', what: `${M1.label} was already closed before this test` })
    const o = await order({ lines: [{ description: `Hunt books locked gauge ${T}`, qty: 1, price: 50000 }], orderedOn: M2.day(2) })
    const a = await open(ctxA, info, `/money/reports/in-out?by=month&period=${M1.key}`, 'admin A', [400])
    let inOutOpen: InOut | null = null
    await probe(info, a, 'read In vs out for the month while open', async () => {
      inOutOpen = await readInOut(a, info, `/money/reports/in-out?by=month&period=${M1.key}`)
    })

    // admin B: Add expense open on a phone, dated in last month, not saved yet
    const b = await open(ctxB, info, '/money/expenses?add=1', 'admin B phone', [400])
    const bd = b.getByRole('dialog', { name: 'Add expense' })
    await probe(info, b, 'admin B fills Add expense dated in last month (not saved)', async () => {
      await bd.getByRole('textbox', { name: 'Amount, PKR' }).fill(String(amtC), { timeout: 10_000 })
      await bd.getByRole('textbox', { name: 'Date paid' }).fill(typed(M1.day(20)))
      await bd.getByRole('button', { name: 'Add a detail' }).click()
      await bd.getByRole('combobox', { name: 'Detail' }).fill(descC)
    })
    // admin C: a Month-end page opened now, used after A has closed (stale)
    const c = await open(ctxC, info, `/money/month-end?month=${M1.key}`, 'admin C', [400])

    await probe(info, a, 'admin A closes the month (double-click on the confirm)', async () => {
      await visit(a, info, `/money/month-end?month=${M1.key}`, 'month-end A')
      await layout(a, info, 'month-end desktop open')
      await shot(a, 'books-month-end-open')
      await a.getByRole('button', { name: new RegExp(`^Close (through )?${M1.name}$`) }).click({ timeout: 10_000 })
      const dlg = a.getByRole('dialog', { name: `Close ${M1.label}?` })
      await dlg.waitFor({ timeout: 10_000 })
      await layout(a, info, 'close dialog')
      await shot(a, 'books-close-dialog')
      await dlg.getByRole('button', { name: new RegExp(`^Close (through )?${M1.name}$`) }).dblclick()
      await a.getByTestId('lock-bar').waitFor({ timeout: 15_000 })
      if ((await a.getByText('The month was not closed').count()) > 0) note(info, { kind: 'observation', where: 'close double-click', what: 'an error banner after a double-click on Close' })
      if (!(await closedMonths()).includes(M1.start)) throw new Error('the month is not in closed_months')
      await shot(a, 'books-month-end-closed')
    })

    await probe(info, b, 'admin B saves the expense dated in the now closed month: the plain sentence, nothing saved', async () => {
      await bd.getByRole('button', { name: 'Save expense' }).click()
      const shown = await b.getByText(sentence).isVisible({ timeout: 10_000 }).catch(() => false)
      const saved = await db.rows(`expenses?description=eq.${encodeURIComponent(descC)}&select=id`)
      if (saved.length) note(info, { kind: 'observation', where: 'closed month race', what: 'an expense dated in a month another admin just closed WAS saved' })
      if (!shown) note(info, { kind: 'observation', where: 'closed month race', what: 'no closed-month sentence', detail: (await bd.innerText().catch(() => '')).slice(0, 400) })
      const kept = await bd.getByRole('textbox', { name: 'Amount, PKR' }).inputValue().catch(() => '')
      if (kept.replace(/,/g, '') !== String(amtC)) note(info, { kind: 'observation', where: 'closed month race', what: `the amount was not kept (${kept})` })
      await layout(b, info, 'closed refusal phone')
      await shot(b, 'books-closed-refusal-phone')
    })

    await probe(info, c, 'admin C on a stale Month-end page presses Close', async () => {
      const btn = c.getByRole('button', { name: new RegExp(`^Close (through )?${M1.name}$`) })
      if (!(await btn.isVisible({ timeout: 3_000 }).catch(() => false))) return
      await btn.click()
      const dlg = c.getByRole('dialog', { name: `Close ${M1.label}?` })
      await dlg.getByRole('button', { name: new RegExp(`^Close (through )?${M1.name}$`) }).click({ timeout: 10_000 })
      await sleep(2000)
      note(info, { kind: 'observation', where: 'stale close', what: `a second admin closing an already-closed month sees: ${(await c.locator('body').innerText()).replace(/\s+/g, ' ').match(/(closed|could not|went wrong)[^.]*\./gi)?.slice(0, 3).join(' | ') ?? 'nothing'}` })
      await c.keyboard.press('Escape')
    })

    await probe(info, a, 'Record payment dated in the closed month: the sentence, nothing saved', async () => {
      await visit(a, info, `/orders/${o.order.id}`, 'order A')
      await a.getByRole('button', { name: 'Record payment' }).first().click({ timeout: 10_000 })
      const d = a.getByRole('dialog', { name: 'Record payment' })
      await d.getByRole('textbox', { name: 'Amount received, PKR' }).fill('10,000')
      await d.getByRole('textbox', { name: 'Date received' }).fill(typed(M1.day(5)))
      await d.getByRole('button', { name: 'Save payment' }).click()
      if (!(await d.getByText(sentence).isVisible({ timeout: 10_000 }).catch(() => false))) note(info, { kind: 'observation', where: 'closed month payment', what: 'no plain sentence', detail: (await d.innerText()).slice(0, 400) })
      if ((await db.rows(`payments_in?order_id=eq.${o.order.id}&select=id`)).length) note(info, { kind: 'observation', where: 'closed month payment', what: 'a payment dated in a closed month was saved' })
      await a.keyboard.press('Escape')
    })

    await probe(info, a, 'Create invoice dated in the closed month: the sentence, nothing saved', async () => {
      await visit(a, info, `/orders/${o.order.id}`, 'order A invoice')
      await a.getByRole('button', { name: 'Create invoice' }).first().click({ timeout: 10_000 })
      const d = a.getByRole('dialog', { name: 'Create invoice' })
      await d.getByRole('textbox', { name: 'Invoice date' }).fill(typed(M1.day(6)))
      await d.getByRole('button', { name: 'Create invoice' }).click()
      if (!(await d.getByText(sentence).isVisible({ timeout: 10_000 }).catch(() => false))) note(info, { kind: 'observation', where: 'closed month invoice', what: 'no plain sentence', detail: (await d.innerText()).slice(0, 400) })
      if ((await db.rows(`invoices?order_id=eq.${o.order.id}&select=id`)).length) note(info, { kind: 'observation', where: 'closed month invoice', what: 'an invoice dated in a closed month was created' })
      await a.keyboard.press('Escape')
    })

    await probe(info, a, 'In vs out and P&L of the closed month: frozen, same figures', async () => {
      const now = await readInOut(a, info, `/money/reports/in-out?by=month&period=${M1.key}`)
      if (!now.frozen) note(info, { kind: 'observation', where: 'in-out closed', what: 'no "frozen" note on a closed month' })
      if (inOutOpen) {
        const o0 = inOutOpen as InOut
        same(info, 'in-out closed', 'money in, closed vs open', now.in, o0.in)
        same(info, 'in-out closed', 'money out, closed vs open', now.out, o0.out)
      }
      await visit(a, info, `/money/reports/pnl?month=${M1.key}`, 'pnl closed')
      if (!(await a.getByTestId('pnl-frozen').isVisible({ timeout: 5_000 }).catch(() => false))) note(info, { kind: 'observation', where: 'pnl closed', what: 'no "Frozen when the month was closed" on the P&L' })
    })

    await probe(info, b, 'phone: Month end of the closed month', async () => {
      await visit(b, info, `/money/month-end?month=${M1.key}`, 'month-end phone closed')
      await layout(b, info, 'month-end phone closed')
      await shot(b, 'books-month-end-closed-phone')
    })

    await probe(info, a, 'admin A reopens from the closed-months list', async () => {
      await visit(a, info, `/money/month-end?month=${M1.key}`, 'month-end reopen')
      await a.getByTestId(`closed-${M1.key}`).getByRole('button', { name: `Reopen ${M1.label}` }).click({ timeout: 10_000 })
      const dlg = a.getByRole('dialog', { name: `Reopen ${M1.label}?` })
      await dlg.getByRole('textbox').fill('hunt: reopen check')
      await dlg.getByRole('button', { name: `Reopen ${M1.name}` }).click()
      await a.getByTestId('lock-bar').waitFor({ state: 'detached', timeout: 15_000 })
      if ((await closedMonths()).includes(M1.start)) throw new Error('still in closed_months after Reopen')
      const after = await readInOut(a, info, `/money/reports/in-out?by=month&period=${M1.key}`)
      if (after.frozen) note(info, { kind: 'observation', where: 'in-out reopened', what: 'still says frozen after the month was reopened' })
    })

    await probe(info, b, 'admin B: Try again on the refused form now saves once', async () => {
      await visit(b, info, '/money/expenses?add=1', 'admin B retry')
      // the earlier dialog was left by the visit above; refill and save in the reopened month
      const d = b.getByRole('dialog', { name: 'Add expense' })
      await d.getByRole('textbox', { name: 'Amount, PKR' }).fill(String(amtC), { timeout: 10_000 })
      await d.getByRole('textbox', { name: 'Date paid' }).fill(typed(M1.day(20)))
      await d.getByRole('button', { name: 'Add a detail' }).click()
      await d.getByRole('combobox', { name: 'Detail' }).fill(descC)
      await d.getByRole('button', { name: /^(Save expense|Try again)$/ }).click()
      await d.waitFor({ state: 'hidden', timeout: 10_000 })
      const n = (await db.rows(`expenses?description=eq.${encodeURIComponent(descC)}&select=id`)).length
      if (n !== 1) note(info, { kind: 'observation', where: 'after reopen', what: `${n} expenses saved` })
    })
  } finally {
    await reopenSince(before).catch(e => note(info, { kind: 'observation', where: 'close cleanup', what: `could not reopen: ${String(e)}` }))
    await ctxA.close()
    await ctxB.close()
    await ctxC.close()
  }
})

// ================================================================================================ 4. team

test('team: add a person, they sign in on a phone; deactivate, reactivate, change role and reset password while their session is open', async ({ browser }, info) => {
  test.setTimeout(360_000)
  const name = `Hunt Person ${T}`
  const email = `hunt-${T}-${Date.now().toString(36)}@test.invalid`
  let password = ''
  let userId = ''
  const admin = await ctxAs(browser, info, 'admin', 'desktop')
  const a = await open(admin, info, '/settings/team', 'admin team', [400, 409, 422])
  const rowAction = async (item: string) => {
    await a.getByRole('button', { name: `Actions for ${name}` }).click({ timeout: 10_000 })
    await a.getByRole('menuitem', { name: item }).click()
  }
  const person = await blankCtx(browser, info, 'phone')
  const p = await person.newPage()
  watch(p, info, 'new person phone', { allowStatus: [400, 401, 403] })
  try {
    await probe(info, a, 'Add person: validation, then a double-click on Create account', async () => {
      await layout(a, info, 'team desktop')
      await shot(a, 'books-team-desktop')
      await a.getByRole('button', { name: 'Add person' }).click({ timeout: 10_000 })
      const d = a.getByRole('dialog', { name: 'Add person' })
      await d.getByRole('button', { name: 'Create account' }).click()
      if (!(await d.getByText('Enter the name of the person.').isVisible({ timeout: 5_000 }).catch(() => false))) note(info, { kind: 'observation', where: 'add person', what: 'empty form: no "Enter the name" message' })
      await d.getByLabel(/Full name/).fill(name)
      await d.getByLabel(/Email/).fill('not-an-email')
      await d.getByRole('button', { name: 'Create account' }).click()
      if (!(await d.getByText(/valid email/).isVisible({ timeout: 5_000 }).catch(() => false))) note(info, { kind: 'observation', where: 'add person', what: 'bad email: no message' })
      await d.getByLabel(/Email/).fill(email)
      await layout(a, info, 'add person dialog')
      await d.getByRole('button', { name: 'Create account' }).dblclick()
      const secret = a.getByRole('dialog', { name: 'Account created' })
      await secret.waitFor({ timeout: 20_000 })
      password = ((await a.getByTestId('generated-password').textContent()) ?? '').replace(/\s+/g, '')
      await secret.getByRole('button', { name: 'Copy', exact: true }).click()
      await secret.getByRole('button', { name: 'Done' }).click()
      const users = await db.rows<{ id: string; role: string }>(`users?name=eq.${encodeURIComponent(name)}&select=id,role`)
      if (users.length !== 1) note(info, { kind: 'observation', where: 'add person double-click', what: `${users.length} users rows for one double-click` })
      userId = users[0]?.id ?? ''
      if (users[0]?.role !== 'sales') note(info, { kind: 'observation', where: 'add person', what: `role ${users[0]?.role}, expected the default sales` })
      if (!password) throw new Error('no password shown')
    })

    await probe(info, p, 'the new person signs in through /login on a phone and uses the app', async () => {
      await signIn(p, email, password)
      if (!(await signedInApp(p))) throw new Error(`not signed in: ${p.url()} ${(await p.locator('body').innerText()).slice(0, 200)}`)
      await visit(p, info, '/today', 'person today')
      await layout(p, info, 'new person today phone')
      await shot(p, 'books-new-person-today-phone')
      await visit(p, info, '/money/receivables', 'person receivables')
      if (await refused(p)) note(info, { kind: 'access', where: 'new sales person', what: '/money/receivables refused for a sales person' })
    })

    await probe(info, a, 'admin deactivates the person while their session is open', async () => {
      await rowAction('Deactivate')
      const d = a.getByRole('dialog', { name: `Deactivate ${name}?` })
      await d.getByRole('button', { name: /^Deactivate / }).click()
      await d.waitFor({ state: 'hidden', timeout: 15_000 })
    })

    await probe(info, p, 'deactivated: the open session on its next navigation and next save', async () => {
      const t0 = Date.now()
      await spaGo(p, '/rfqs')
      const out = await within(45_000, async () => new URL(p.url()).pathname.startsWith('/login'))
      const secs = Math.round((Date.now() - t0) / 1000)
      note(info, { kind: 'observation', where: 'deactivated open session', what: out ? `signed out ${secs} s after the next navigation` : `still in the app ${secs} s after a navigation: ${p.url()}` })
      if (!out) {
        // try a save: a new company (recorded, never fails this step)
        const co = `Hunt Deactivated Co ${T}`
        try {
          await spaGo(p, '/companies')
          await p.getByRole('button', { name: 'New company' }).first().click({ timeout: 5_000 })
          await p.getByRole('dialog', { name: 'New company' }).getByRole('textbox', { name: /Company name/ }).fill(co)
          await p.getByRole('dialog', { name: 'New company' }).getByRole('button', { name: 'Add company' }).click()
          await sleep(3000)
        } catch (e) {
          note(info, { kind: 'observation', where: 'deactivated open session', what: `the save attempt could not be made: ${String(e).split('\n')[0]}` })
        }
        if ((await db.rows(`companies?name=eq.${encodeURIComponent(co)}&select=id`)).length) note(info, { kind: 'observation', where: 'deactivated open session', what: 'a deactivated person SAVED a company from the open session' })
        await shot(p, 'books-deactivated-session-after-save')
      }
      const banner = await p.getByText('This account is deactivated').isVisible({ timeout: 10_000 }).catch(() => false)
      if (!banner) note(info, { kind: 'observation', where: 'deactivated open session', what: `no "This account is deactivated" (url ${p.url()})` })
      await shot(p, 'books-deactivated-signed-out-phone')
      await signIn(p, email, password)
      if (await signedInApp(p)) note(info, { kind: 'observation', where: 'deactivated sign-in', what: 'a deactivated person could sign in again' })
    })

    await probe(info, a, 'admin reactivates; the person signs in again with the same password', async () => {
      await a.getByRole('button', { name: `Reactivate ${name}` }).click({ timeout: 10_000 })
      await a.getByRole('dialog', { name: `Reactivate ${name}?` }).getByRole('button', { name: 'Reactivate' }).click()
      await a.getByRole('dialog', { name: `Reactivate ${name}?` }).waitFor({ state: 'hidden', timeout: 15_000 })
      await signIn(p, email, password)
      if (!(await signedInApp(p))) throw new Error(`reactivated person cannot sign in: ${(await p.locator('body').innerText()).slice(0, 200)}`)
      await visit(p, info, '/money/receivables', 'person receivables again')
    })

    await probe(info, a, 'role sales -> engineer while signed in: does the open session lose Money?', async () => {
      await rowAction('Change role')
      const d = a.getByRole('dialog', { name: /Change .* role/ })
      await d.getByRole('radio', { name: /Engineer/ }).click()
      await d.getByRole('button', { name: 'Change role' }).click()
      await d.waitFor({ state: 'hidden', timeout: 15_000 })
      const moneyRows: string[] = []
      p.on('response', async r => {
        if (!/\/rest\/v1\/(payments_in|invoices|v_order_money|rpc\/order_receivables)/.test(r.url()) || r.status() >= 300) return
        const body = await r.text().catch(() => '')
        if (body.length > 2 && body !== '[]') moneyRows.push(`${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 120)} -> ${body.slice(0, 80)}`)
      })
      await spaGo(p, '/today')
      await sleep(6000)
      await spaGo(p, '/money/receivables')
      const lost = await within(15_000, async () => (await refused(p)) || new URL(p.url()).pathname.startsWith('/no-access'))
      if (!lost) note(info, { kind: 'observation', where: 'role change open session', what: `15 s after the change to engineer the open session still shows Money (${p.url()})` })
      if (moneyRows.length) note(info, { kind: 'access', where: 'role change open session', what: 'money rows returned to the session after it became engineer', detail: moneyRows.slice(0, 5) })
      await shot(p, 'books-role-changed-phone')
    })

    let newPassword = ''
    await probe(info, a, 'reset password while the person is signed in', async () => {
      await rowAction('Reset password')
      await a.getByRole('dialog', { name: /Reset .* password\?/ }).getByRole('button', { name: 'Reset password' }).click()
      const r = a.getByRole('dialog', { name: 'Password reset' })
      await r.waitFor({ timeout: 15_000 })
      newPassword = ((await a.getByTestId('generated-password').textContent()) ?? '').replace(/\s+/g, '')
      await r.getByRole('button', { name: 'Copy', exact: true }).click()
      await r.getByRole('button', { name: 'Done' }).click()
      // the dialog said: "their current password stops working and they are signed out on every device"
      await spaGo(p, '/rfqs')
      await sleep(6000)
      await p.reload()
      await settle(p)
      if (await signedInApp(p)) note(info, { kind: 'observation', where: 'reset password open session', what: 'the person is still signed in after Reset password (the dialog promises "signed out on every device")' })
      const fresh = await blankCtx(browser, info, 'desktop')
      const fp = await fresh.newPage()
      await signIn(fp, email, password)
      if (await signedInApp(fp)) note(info, { kind: 'observation', where: 'reset password', what: 'the OLD password still signs in' })
      await signIn(fp, email, newPassword)
      if (!(await signedInApp(fp))) note(info, { kind: 'observation', where: 'reset password', what: 'the NEW password does not sign in' })
      await fresh.close()
    })

    await probe(info, null, 'change password as the person: wrong current, mismatch, too short, then a real change', async () => {
      const ctx = await blankCtx(browser, info, 'desktop')
      const pg = await ctx.newPage()
      watch(pg, info, 'person change password', { allowStatus: [400, 422] })
      await signIn(pg, email, newPassword)
      await visit(pg, info, '/settings/password', 'change password')
      const fill = async (cur: string, next: string, conf: string) => {
        await pg.getByLabel('Current password').fill(cur)
        await pg.getByLabel('New password', { exact: true }).fill(next)
        await pg.getByLabel('Confirm new password').fill(conf)
        await pg.getByRole('button', { name: /^(Change password|Try again)$/ }).click()
        await sleep(1500)
      }
      await fill('wrong-current-password', 'Hunt-long-enough-pw', 'Hunt-long-enough-pw')
      if (!(await pg.getByText('Current password is incorrect.').isVisible().catch(() => false))) note(info, { kind: 'observation', where: 'change password', what: 'wrong current: no "Current password is incorrect."' })
      await spaGo(pg, '/today')
      if (!(await signedInApp(pg))) note(info, { kind: 'observation', where: 'change password', what: 'a wrong current password signed the person out' })
      await visit(pg, info, '/settings/password', 'change password 2')
      await fill(newPassword, 'Hunt-long-enough-pw', 'Hunt-long-enough-px')
      if (!(await pg.getByText('The two new passwords do not match.').isVisible().catch(() => false))) note(info, { kind: 'observation', where: 'change password', what: 'mismatch: no message' })
      await fill(newPassword, 'short', 'short')
      if (!(await pg.getByText('Use at least 12 characters.').isVisible().catch(() => false))) note(info, { kind: 'observation', where: 'change password', what: 'too short: no message' })
      const renewed = `Hunt-${T}-renewed-pw`
      await fill(newPassword, renewed, renewed)
      if (!(await pg.getByText('Password changed').isVisible({ timeout: 10_000 }).catch(() => false))) note(info, { kind: 'observation', where: 'change password', what: 'no "Password changed" after a valid change' })
      await layout(pg, info, 'change password')
      const check = await blankCtx(browser, info, 'phone')
      const cp = await check.newPage()
      await signIn(cp, email, renewed)
      if (!(await signedInApp(cp))) note(info, { kind: 'observation', where: 'change password', what: 'the changed password does not sign in' })
      await check.close()
      await ctx.close()
    })
  } finally {
    if (!userId) userId = (await db.rows<{ id: string }>(`users?name=eq.${encodeURIComponent(name)}&select=id`).catch(() => []))[0]?.id ?? ''
    if (userId) await adminUsers({ action: 'deactivate', user_id: userId }).catch(() => undefined)
    await person.close()
    await admin.close()
  }
})

// ================================================================================================ 5. settings

test('settings: company profile, exchange rates, targets, categories, my details and change password, with role access by URL and palette', async ({ browser }, info) => {
  test.setTimeout(300_000)
  const ctx = await ctxAs(browser, info, 'admin', 'desktop')
  const page = await open(ctx, info, '/settings/company', 'admin settings', [400, 409, 422])
  const PROFILE_COLS = 'legal_name,address,phone,email,website,ntn,strn,bank_name,bank_account_title,bank_iban,quotation_terms,po_terms,quotation_validity_days,default_payment_terms_days'
  const profile = await db.one<Record<string, unknown>>(`company_profile?id=eq.1&select=${PROFILE_COLS}`)
  const fxBefore = (await db.rows<{ id: string }>('fx_rates?currency=eq.SAR&select=id')).map(r => r.id)
  const Y1 = Number(TODAY.slice(0, 4)) + 1
  const myPhone = (await db.one<{ phone: string | null }>(`users?id=eq.${USER.admin}&select=phone`)).phone
  try {
    await probe(info, page, 'company profile: validity 0 and text, negative terms', async () => {
      await page.getByLabel('Quotation validity').fill('0', { timeout: 10_000 })
      await page.getByLabel('Default payment terms').fill('-5')
      await page.getByRole('button', { name: 'Save changes' }).click()
      await sleep(800)
      if (!(await page.getByText('A quotation must be valid for at least 1 day.').isVisible().catch(() => false))) note(info, { kind: 'observation', where: 'company profile', what: 'validity 0: no message' })
      if (!(await page.getByText('Payment terms cannot be negative.').isVisible().catch(() => false))) note(info, { kind: 'observation', where: 'company profile', what: 'terms -5: no message' })
      await page.getByLabel('Quotation validity').fill('abc')
      await page.getByRole('button', { name: 'Save changes' }).click()
      await sleep(800)
      const v = await db.one<{ quotation_validity_days: number; default_payment_terms_days: number }>('company_profile?id=eq.1&select=quotation_validity_days,default_payment_terms_days')
      if (v.quotation_validity_days <= 0 || v.default_payment_terms_days < 0) note(info, { kind: 'observation', where: 'company profile', what: 'an invalid number was saved', detail: v })
      await shot(page, 'books-profile-invalid')
      await page.getByRole('button', { name: 'Discard' }).click()
    })

    await probe(info, page, 'company profile: empty legal name, junk NTN, double-click Save (one request)', async () => {
      let patches = 0
      page.on('request', r => {
        if (r.method() === 'PATCH' && r.url().includes('/rest/v1/company_profile')) patches++
      })
      await page.getByLabel(/Legal name/).fill('')
      await page.getByLabel('NTN').fill('not-an-ntn !!')
      await page.getByRole('button', { name: 'Save changes' }).dblclick()
      await sleep(2500)
      const row = await db.one<{ legal_name: string | null; ntn: string | null }>('company_profile?id=eq.1&select=legal_name,ntn')
      if (row.ntn === 'not-an-ntn !!') note(info, { kind: 'observation', where: 'company profile', what: 'an NTN "not-an-ntn !!" is accepted and saved (no format check; it prints on invoices)' })
      if (row.legal_name === null) note(info, { kind: 'observation', where: 'company profile', what: 'the legal name can be emptied and saved (PDFs then refuse); by design?', detail: await page.getByText(/PDFs can.t be issued/).first().innerText().catch(() => '') })
      if (patches > 1) note(info, { kind: 'observation', where: 'company profile double-click', what: `${patches} PATCH requests for one double-click` })
      await layout(page, info, 'company profile')
    })

    await probe(info, page, 'company profile: Back and reload with unsaved changes', async () => {
      await visit(page, info, '/settings/company', 'profile again')
      await page.getByLabel('Website').fill('hunt-unsaved.invalid')
      let dialog = ''
      page.once('dialog', d => {
        dialog = d.message() || d.type()
        void d.dismiss()
      })
      await page.goBack()
      await settle(page)
      note(info, { kind: 'observation', where: 'company profile Back', what: `Back with an unsaved change: ${dialog ? `browser asked "${dialog}"` : `no question, now at ${page.url()}`}` })
      await visit(page, info, '/settings/company', 'profile reload')
      await page.getByLabel('Website').fill('hunt-unsaved.invalid')
      await page.reload()
      await settle(page)
      note(info, { kind: 'observation', where: 'company profile reload', what: `after reload Website is "${await page.getByLabel('Website').inputValue().catch(() => '?')}"` })
    })

    await probe(info, page, 'exchange rates: zero, negative, huge and a future date (SAR)', async () => {
      await visit(page, info, '/settings/exchange-rates', 'rates')
      const form = page.locator('form')
      await form.getByLabel('Currency').selectOption('SAR')
      const rate = form.getByLabel('Rate, PKR for 1 unit')
      const save = page.getByRole('button', { name: 'Save rate' })
      for (const v of ['0', '-5', 'abc']) {
        await rate.fill(v)
        if (!(await save.isDisabled())) note(info, { kind: 'observation', where: 'exchange rates', what: `Save rate is enabled for "${v}"` })
      }
      await rate.fill('1000000000')
      await save.click()
      await sleep(2000)
      const toast = (await page.getByRole('status').allInnerTexts().catch(() => [])).join(' | ')
      note(info, { kind: 'observation', where: 'exchange rates huge', what: `1,000,000,000 PKR per SAR: ${toast.slice(0, 300) || 'no message'}` })
      await rate.fill('50000000')
      await save.click()
      await sleep(2000)
      const huge = await db.rows<{ rate_pkr: number }>(`fx_rates?currency=eq.SAR&as_of=eq.${TODAY}&select=rate_pkr`)
      if (huge.some(r => Number(r.rate_pkr) >= 50000000)) note(info, { kind: 'observation', where: 'exchange rates', what: 'a SAR rate of 50,000,000 PKR is accepted without a sanity check' })
      await rate.fill('75')
      await form.getByLabel('As of').fill(typed(karachiDay(30)))
      await form.getByLabel('As of').press('Tab')
      await save.click()
      await sleep(2000)
      const future = await db.rows<{ as_of: string }>(`fx_rates?currency=eq.SAR&as_of=gt.${TODAY}&select=as_of`)
      if (future.length) {
        const latest = await db.view<{ as_of: string; rate_pkr: number }>('v_fx_latest?currency=eq.SAR&select=as_of,rate_pkr')
        note(info, { kind: 'observation', where: 'exchange rates', what: `a rate dated 30 days ahead is accepted; v_fx_latest now says ${JSON.stringify(latest)}` })
      }
      await layout(page, info, 'exchange rates')
      await shot(page, 'books-exchange-rates')
    })

    await probe(info, page, 'targets: text and a negative in a cell that holds a target', async () => {
      await db.add('targets', { user_id: USER.engineer, year: Y1, quarter: 1, target_net_pkr: 500000 })
      await visit(page, info, '/settings/targets', 'targets')
      await page.getByRole('button', { name: 'Next year' }).click()
      const cell = page.getByRole('button', { name: new RegExp(`^Test Engineer, Q1 ${Y1} target`) })
      await cell.click({ timeout: 10_000 })
      const input = page.getByRole('textbox', { name: new RegExp(`Test Engineer, Q1 ${Y1} target in rupees`) })
      await input.fill('-5')
      await input.press('Enter')
      if (!(await page.getByText(/A target must be above 0/).isVisible({ timeout: 3_000 }).catch(() => false))) note(info, { kind: 'observation', where: 'targets', what: '-5: no "above 0" message' })
      await input.fill('abc')
      await input.press('Enter')
      await sleep(2000)
      const left = await db.rows(`targets?user_id=eq.${USER.engineer}&year=eq.${Y1}&quarter=eq.1&select=target_net_pkr`)
      if (left.length === 0) note(info, { kind: 'observation', where: 'targets', what: 'typing "abc" + Enter in a cell holding a target REMOVED the target (text is read as empty)' })
      await shot(page, 'books-targets-text')
      await page.keyboard.press('Escape')
    })

    await probe(info, page, 'categories: rename to a duplicate, delete in use, Enter twice on Add', async () => {
      const c = `Hunt Settings Cat ${T}`
      const made = await post<{ id: string }>('expense_categories', { name: c, grp: 'overhead', default_paid_via: 'bank', sort: 995 })
      await post('expenses', { amount_pkr: 1, category_id: made.id, paid_on: TODAY, paid_via: 'bank', description: `hunt in use ${T}` })
      await visit(page, info, '/settings/categories', 'categories')
      const row = page.locator(`[data-category="${c}"]`)
      const nameBox = row.getByLabel(`Name of ${c}`)
      await nameBox.fill(' rent ', { timeout: 10_000 })
      await nameBox.press('Enter')
      if (!(await row.getByText('A category with this name already exists.').isVisible({ timeout: 3_000 }).catch(() => false))) note(info, { kind: 'observation', where: 'categories rename', what: 'renaming to " rent " gave no duplicate message' })
      if ((await db.one<{ name: string }>(`expense_categories?id=eq.${made.id}&select=name`)).name !== c) note(info, { kind: 'observation', where: 'categories rename', what: 'a duplicate rename was saved' })
      await nameBox.press('Escape')
      await row.getByRole('button', { name: `Delete ${c}` }).click()
      const panel = row.getByRole('group', { name: `Delete ${c}` })
      if (!/cannot be deleted/.test(await panel.innerText({ timeout: 5_000 }))) note(info, { kind: 'observation', where: 'categories delete', what: 'in-use category: no "cannot be deleted"' })
      if ((await panel.getByRole('button', { name: 'Delete', exact: true }).count()) > 0) note(info, { kind: 'observation', where: 'categories delete', what: 'in-use category still offers Delete' })
      await panel.getByRole('button', { name: 'Close' }).click()
      const dbl = `Hunt Twice ${T}`
      await page.getByLabel('New category').fill(dbl)
      await page.getByLabel('New category').press('Enter')
      await page.getByLabel('New category').press('Enter')
      await sleep(2500)
      const n = (await db.rows(`expense_categories?name=eq.${encodeURIComponent(dbl)}&select=id`)).length
      const err = await page.getByText('A category with this name already exists.').isVisible().catch(() => false)
      if (n !== 1 || err) note(info, { kind: 'observation', where: 'categories add Enter twice', what: `${n} rows; duplicate message shown: ${err}` })
      await layout(page, info, 'categories')
    })

    await probe(info, page, 'my details: a phone number over 30 characters', async () => {
      await visit(page, info, '/settings/details', 'my details')
      await page.getByLabel(/Phone/).fill('0300 1234567 ext 1234567890 1234')
      await page.getByRole('button', { name: /^(Save|Save changes)$/ }).click()
      await sleep(1000)
      if (!(await page.getByText(/under 30 characters/).isVisible().catch(() => false))) note(info, { kind: 'observation', where: 'my details', what: 'a 32-character phone gave no message' })
      const ph = (await db.one<{ phone: string | null }>(`users?id=eq.${USER.admin}&select=phone`)).phone
      if (ph !== myPhone) note(info, { kind: 'observation', where: 'my details', what: `phone saved as "${ph}"` })
    })

    await probe(info, page, 'change password as the admin: wrong current, mismatch, short; nothing changes, still signed in', async () => {
      await visit(page, info, '/settings/password', 'admin change password')
      const fill = async (cur: string, next: string, conf: string) => {
        await page.getByLabel('Current password').fill(cur)
        await page.getByLabel('New password', { exact: true }).fill(next)
        await page.getByLabel('Confirm new password').fill(conf)
        await page.getByRole('button', { name: /^(Change password|Try again)$/ }).click()
        await sleep(1500)
      }
      await fill('', 'x', '')
      await fill('definitely-not-it', 'Hunt-long-enough-pw', 'Hunt-long-enough-pw')
      if (!(await page.getByText('Current password is incorrect.').isVisible().catch(() => false))) note(info, { kind: 'observation', where: 'admin change password', what: 'wrong current: no message' })
      await fill('definitely-not-it', 'Hunt-long-enough-pw', 'Hunt-long-enough-px')
      await fill('definitely-not-it', 'short', 'short')
      await layout(page, info, 'change password errors')
      await shot(page, 'books-change-password-errors')
      await visit(page, info, '/today', 'after change password')
      if (!(await signedInApp(page))) note(info, { kind: 'observation', where: 'admin change password', what: 'the admin was signed out by the failed attempts' })
      const r = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'admin@test.invalid', password: 'fixture-only-password' }),
      })
      if (r.status !== 200) note(info, { kind: 'observation', where: 'admin change password', what: `the fixture password no longer signs in (${r.status})` })
    })
    await ctx.close()

    const phone = await ctxAs(browser, info, 'admin', 'phone')
    const pp = await open(phone, info, '/settings', 'admin settings phone')
    for (const s of ['/settings', '/settings/company', '/settings/exchange-rates', '/settings/targets', '/settings/categories', '/settings/team', '/settings/details', '/settings/password'])
      await probe(info, pp, `phone ${s}`, async () => {
        await visit(pp, info, s, `phone ${s}`)
        await layout(pp, info, `phone ${s}`)
        await shot(pp, `books-phone-${s}`)
      })
    await phone.close()

    for (const role of ['sales', 'engineer'] as const) {
      const rc = await ctxAs(browser, info, role, role === 'engineer' ? 'phone' : 'desktop')
      const rp = await open(rc, info, '/today', `${role} admin screens`)
      for (const path of ['/settings/team', '/settings/targets', '/settings/categories', '/money/month-end', '/money/expenses?add=1', '/money/reports/in-out', '/money/reports/pnl', '/money/month-end/bank'])
        await probe(info, rp, `${role} by URL ${path}`, async () => {
          await visit(rp, info, path, `${role} ${path}`)
          if (!(await refused(rp)) && !rp.url().includes('/no-access')) note(info, { kind: 'access', where: `${role} ${path}`, what: `not refused; shows ${(await rp.locator('#main').innerText()).replace(/\s+/g, ' ').slice(0, 160)}` })
          if ((await rp.getByRole('dialog', { name: 'Add expense' }).count()) > 0) note(info, { kind: 'access', where: `${role} ${path}`, what: 'the Add expense dialog opened' })
        })
      await probe(info, rp, `${role}: the Ctrl+K palette offers no admin places`, async () => {
        await visit(rp, info, '/today', `${role} palette`)
        await rp.keyboard.press('Control+k')
        const pal = rp.getByRole('dialog', { name: 'Search or jump to' })
        await pal.waitFor({ timeout: 5_000 })
        const offered: string[] = []
        for (const w of ['Team', 'Targets', 'Expense categories', 'Month end', 'In vs out', 'Add expenses', 'Match bank statement', 'Order margins']) {
          await pal.getByRole('combobox').fill(w)
          await sleep(700)
          if ((await pal.getByRole('option', { name: new RegExp(`^${esc(w)}`) }).count()) > 0) offered.push(w)
        }
        if (offered.length) note(info, { kind: 'access', where: `${role} palette`, what: `offers admin places: ${offered.join(', ')}` })
        await rp.keyboard.press('Escape')
      })
      await rc.close()
    }
  } finally {
    await db.patch('company_profile?id=eq.1', profile).catch(() => undefined)
    for (const r of await db.rows<{ id: string }>('fx_rates?currency=eq.SAR&select=id').catch(() => [] as { id: string }[]))
      if (!fxBefore.includes(r.id)) await db.del(`fx_rates?id=eq.${r.id}`).catch(() => undefined)
    await db.del(`targets?user_id=eq.${USER.engineer}&year=eq.${Y1}`).catch(() => undefined)
    await db.patch(`users?id=eq.${USER.admin}`, { phone: myPhone }).catch(() => undefined)
    await ctx.close().catch(() => undefined)
  }
})

// ================================================================================================ confirmed bugs (run 1)
// Each: the setup runs normally (a broken setup is a red failure), then test.fail() right before the one expect that states the
// correct behaviour, so a fix flips the test.

test('HW-17: after Reset password the open session keeps working (the dialog promises they are signed out on every device)', async ({ browser }, info) => {
  const email = `hunt-reset-${tag(6)}-${Date.now().toString(36)}@test.invalid`
  const created = await adminUsers({ action: 'create', name: `Hunt Reset ${tag(5)}`, email, role: 'sales' })
  expect(created.status).toBe(200)
  const userId = String((created.json?.user as { id?: string } | undefined)?.id ?? '')
  const password = String(created.json?.password ?? '')
  expect(userId).not.toBe('')
  const ctx = await blankCtx(browser, info, 'desktop')
  try {
    const page = await ctx.newPage()
    await signIn(page, email, password)
    expect(await signedInApp(page)).toBe(true)
    const accessToken = await page.evaluate(() => {
      const key = Object.keys(localStorage).find(k => k.endsWith('-auth-token'))
      return key ? ((JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string }).access_token ?? '') : ''
    })
    expect(accessToken).not.toBe('')
    const reset = await adminUsers({ action: 'reset_password', user_id: userId })
    expect(reset.status).toBe(200)
    // "Signed out on every device": the session made before the reset must not read data any more. (Run 2: its refresh token IS
    // refused, but the access token it already holds keeps working until it expires, up to an hour.)
    const read = await fetch(`${API_URL}/rest/v1/companies?select=id&limit=1`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${accessToken}` } })
    test.fail(true, 'HW-17: admin-users reset_password changes the password but the open session keeps reading data on its access token until it expires (the dialog says they are signed out on every device)')
    expect(read.status, 'the pre-reset session is refused').toBeGreaterThanOrEqual(400)
  } finally {
    await ctx.close()
    await adminUsers({ action: 'deactivate', user_id: userId }).catch(() => undefined)
  }
})

test("HW-18: Targets: typing 'abc' + Enter in a cell that holds a target removes the target", async ({ browser }, info) => {
  const Y1 = Number(TODAY.slice(0, 4)) + 1
  await db.del(`targets?user_id=eq.${USER.engineer}&year=eq.${Y1}`)
  await db.add('targets', { user_id: USER.engineer, year: Y1, quarter: 1, target_net_pkr: 500000 })
  const ctx = await ctxAs(browser, info, 'admin', 'desktop')
  try {
    const page = await ctx.newPage()
    await page.goto('/settings/targets')
    await page.getByRole('button', { name: 'Next year' }).click()
    await page.getByRole('button', { name: new RegExp(`^Test Engineer, Q1 ${Y1} target`) }).click()
    const input = page.getByRole('textbox', { name: new RegExp(`Test Engineer, Q1 ${Y1} target in rupees`) })
    await input.fill('abc')
    await input.press('Enter')
    await settle(page)
    await sleep(1500)
    const left = await db.rows(`targets?user_id=eq.${USER.engineer}&year=eq.${Y1}&quarter=eq.1&select=id`)
    test.fail(true, 'HW-18: NumberInput turns text into null and null + Enter removes the target (TargetsPage.tsx CellEditor commit)')
    expect(left, 'the target is still there after typing text').toHaveLength(1)
  } finally {
    await db.del(`targets?user_id=eq.${USER.engineer}&year=eq.${Y1}`).catch(() => undefined)
    await ctx.close()
  }
})

test("HW-21: the recurring-expense form shows the developer field name 'startMonth needs a value.' to the person", async ({ browser }, info) => {
  const ctx = await ctxAs(browser, info, 'admin', 'desktop')
  try {
    const page = await ctx.newPage()
    await page.goto('/money/expenses')
    await page.getByRole('button', { name: 'Add recurring' }).click()
    const d = page.getByRole('dialog', { name: 'Add recurring expense' })
    await d.getByRole('textbox', { name: 'Name' }).fill(`Hunt Recurring ${tag(5)}`)
    await d.getByRole('combobox', { name: 'Category' }).fill('Rent')
    await page.keyboard.press('Enter')
    await d.getByRole('textbox', { name: 'Amount, PKR' }).fill('12,345')
    await d.getByRole('textbox', { name: 'Starts in' }).fill('abc')
    await d.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(d.getByText(/Fix 1 field to continue/)).toBeVisible() // the refusal rendered
    test.fail(true, "HW-21: the 'Starts in' error is the schema's default message with the field key, not a sentence for people")
    await expect(d, 'no developer field name in the message').not.toContainText('startMonth', { timeout: 2_000 })
  } finally {
    await ctx.close()
  }
})

test('HW-22: In vs out with ?period=2099-01 silently shows the current month while the address keeps 2099-01', async ({ browser }, info) => {
  const ctx = await ctxAs(browser, info, 'admin', 'desktop')
  try {
    const page = await ctx.newPage()
    await page.goto('/money/reports/in-out?by=month&period=2099-01')
    await page.getByTestId('cash-in').waitFor()
    await expect(page.getByRole('group', { name: 'Period' })).toContainText(M0.label) // it shows the current month
    test.fail(true, 'HW-22: chosenPeriod falls back to now but the address is not corrected (InOutPage usePeriod)')
    expect(new URL(page.url()).searchParams.get('period'), 'the address names the period shown').toBe(M0.key)
  } finally {
    await ctx.close()
  }
})

test('HW-23: Add expense: reload with the dialog half filled loses the typed amount with no warning', async ({ browser }, info) => {
  const ctx = await ctxAs(browser, info, 'admin', 'desktop')
  try {
    const page = await ctx.newPage()
    await page.goto('/money/expenses?add=1')
    const amount = page.getByRole('dialog', { name: 'Add expense' }).getByRole('textbox', { name: 'Amount, PKR' })
    await amount.fill('8765')
    await page.reload()
    await expect(amount).toBeVisible() // the dialog comes back after the reload
    test.fail(true, 'HW-23: nothing keeps a draft and nothing warns before the reload, so the amount is lost')
    await expect(amount, 'the typed amount survives the reload').toHaveValue(/8,?765/, { timeout: 5_000 })
  } finally {
    await ctx.close()
  }
})
