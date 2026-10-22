import { test, type Page } from '@playwright/test'
import { seedWorld, type World } from '../../verify-roles/fixtures'
import { service } from '../../verify-roles/lib'
import { contextAs, layout, note, recordLayout, settle, shot, vp, Watcher } from './lib'

/*
 * Exploration: the forms with edge-case input. Each case types the value, submits, and records what the person sees (the dialog
 * still open or closed, the field and banner messages, the toast) and, where it saved, what the database holds. Records only.
 */
let world: World
test.beforeAll(async () => {
  world = await seedWorld('HF')
})

const LONG = `Hunt Long Name ${'Industrial Instrumentation and Process Automation Engineering '.repeat(5)}`.slice(0, 300)
const NAMES: Record<string, string> = {
  long300: LONG,
  urdu: 'کراچی گلاس ورکس لمیٹڈ ہنٹ',
  emoji: 'Hunt Glass 🏭✨ Works 🇵🇰',
  spaces: '   Hunt Spaced   Name Ltd   ',
  special: `Hunt O'Brien & Sons <b>bold</b> "Quotes" \\ / % _ ; --`,
  unbroken: `Hunt${'X'.repeat(120)}`,
}

const OUTCOME = async (page: Page) => {
  await page.waitForTimeout(1200)
  const dialogOpen = (await page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').count()) > 0
  const msgs = (await page.locator('[role="alert"]:visible, [data-slot="field-error"]:visible, [id$="-error"]:visible').allInnerTexts().catch(() => [] as string[])).map(s => s.trim()).filter(Boolean)
  const toasts = (await page.locator('[role="status"]:visible').allInnerTexts().catch(() => [] as string[])).map(s => s.trim().replace(/\s+/g, ' ')).filter(s => s && s.length < 200)
  return { dialogOpen, msgs: [...new Set(msgs)].join(' | '), toasts: [...new Set(toasts)].join(' | ') }
}

/** Slices by code point, so an emoji is never cut in half (a lone surrogate makes encodeURIComponent throw). */
const cut = (s: string, a: number, b: number) => Array.from(s).slice(a, b).join('')

async function dbRows(path: string): Promise<unknown> {
  const r = await service(`/rest/v1/${path}`)
  return r.json()
}

test('New company: names (long, Urdu, emoji, spaces, special, unbroken, duplicates) at 1366 and 320', async ({ browser }, info) => {
  test.setTimeout(600_000)
  for (const vkey of ['w1366', 'w320']) {
    const context = await contextAs(browser, info, 'sales', vp(vkey))
    const page = await context.newPage()
    const w = new Watcher(page, { role: 'sales', vp: vkey })
    for (const [k, raw] of Object.entries(NAMES)) {
      const name = vkey === 'w320' ? raw.replace('Hunt', 'Hunt2') : raw
      w.at(`/companies?new=1 ${k}`)
      await page.goto('/companies?new=1')
      await settle(page)
      const dialog = page.getByRole('dialog', { name: 'New company' })
      await dialog.getByRole('textbox', { name: /Company name/ }).fill(name)
      await dialog.getByRole('button', { name: /Add company|Try again/ }).click()
      const o = await OUTCOME(page)
      const stored = (await dbRows(`companies?select=id,name&name=ilike.${encodeURIComponent(`*${cut(name.trim(), 5, 25).replace(/[*,()]/g, '_')}*`)}`)) as { id: string; name: string }[]
      note({ kind: 'form', role: 'sales', vp: vkey, path: `new company ${k}`, detail: `typed ${JSON.stringify(name).slice(0, 80)} -> ${JSON.stringify(o)} stored=${JSON.stringify(stored.map(s => s.name)).slice(0, 200)} url=${page.url()}` })
      await shot(page, `form_company_${vkey}_${k}`)
      if (stored[0]) {
        for (const p of [`/companies/${stored[0].id}`, `/companies?q=${encodeURIComponent(cut(name.trim(), 0, 12))}`]) {
          w.at(`${p.startsWith('/companies/') ? '/companies/{id}' : '/companies?q'} name=${k}`)
          await page.goto(p)
          await settle(page)
          recordLayout(w, await layout(page), `company ${k}`)
          await shot(page, `form_company-page_${vkey}_${k}_${p.includes('?') ? 'list' : 'page'}`, true)
        }
      }
    }
    // Duplicates: the same name in another case and with surrounding spaces, and an RFQ intake with it.
    for (const dup of [NAMES.emoji.toUpperCase(), `  ${NAMES.emoji}  `, NAMES.spaces.trim(), NAMES.spaces.replace(/\s+/g, ' ').trim()]) {
      w.at(`/companies?new=1 duplicate`)
      await page.goto('/companies?new=1')
      await settle(page)
      const dialog = page.getByRole('dialog', { name: 'New company' })
      await dialog.getByRole('textbox', { name: /Company name/ }).fill(dup)
      await dialog.getByRole('button', { name: /Add company|Try again/ }).click()
      const o = await OUTCOME(page)
      note({ kind: 'form', role: 'sales', vp: vkey, path: 'new company duplicate', detail: `typed ${JSON.stringify(dup)} -> ${JSON.stringify(o)}` })
      await shot(page, `form_company_${vkey}_dup_${dup.length}`)
    }
    await context.close()
  }
})

const AMOUNTS = ['', '0', '-500', '0.001', '100.555', '1,00,000', '12345.5', '99999999999999', '1e5', '١٢٣', 'abc', ' 2500 ']
const DATES = ['31/02', '29/02/2027', '29/02/2028', '31/12/2026', '30/09/2026', '31/03/2027', '1/1/1900', '1/1/2200', 'tomorrow', '01/01/2020', '32/1']

test('Record payment: amounts and dates (admin)', async ({ browser }, info) => {
  test.setTimeout(600_000)
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  const w = new Watcher(page, { role: 'admin', vp: 'w1366' })
  const path = `/money/receivables?pay=1&order=${world.order.id}`
  const run = async (amount: string | null, date: string | null) => {
    w.at(`record payment a=${amount} d=${date}`)
    await page.goto(path)
    await settle(page)
    const d = page.getByRole('dialog', { name: 'Record payment' })
    await d.getByLabel('Amount received, PKR').waitFor({ timeout: 10_000 }).catch(() => undefined)
    if (amount !== null) await d.getByLabel('Amount received, PKR').fill(amount)
    if (date !== null) {
      await d.getByLabel('Date received').fill(date)
      await d.getByLabel('Date received').press('Tab')
    }
    const shown = { amount: await d.getByLabel('Amount received, PKR').inputValue().catch(() => '?'), date: await d.getByLabel('Date received').inputValue().catch(() => '?') }
    await d.getByRole('button', { name: /Save payment|Try again/ }).click().catch(() => undefined)
    const o = await OUTCOME(page)
    const last = (await dbRows(`payments_in?order_id=eq.${world.order.id}&select=amount,received_on,created_at&order=created_at.desc&limit=1`)) as unknown[]
    note({ kind: 'form', role: 'admin', vp: 'w1366', path: 'record payment', detail: `amount=${JSON.stringify(amount)} date=${JSON.stringify(date)} field-after-blur=${JSON.stringify(shown)} -> ${JSON.stringify(o)} latest=${JSON.stringify(last)}` })
    await shot(page, `form_payment_a${amount}_d${date}`)
  }
  for (const a of AMOUNTS) await run(a, null)
  for (const d of DATES) await run('1000', d)
  await context.close()
})

test('Add expense: amounts, input tax and dates (admin)', async ({ browser }, info) => {
  test.setTimeout(600_000)
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  const w = new Watcher(page, { role: 'admin', vp: 'w1366' })
  const run = async (amount: string, date: string | null, tax: string | null = null) => {
    w.at(`add expense a=${amount} d=${date}`)
    await page.goto('/money/expenses?add=1')
    await settle(page)
    const d = page.getByRole('dialog', { name: 'Add expense' })
    await d.getByLabel('Amount, PKR').fill(amount).catch(() => undefined)
    const cat = d.getByRole('combobox', { name: 'Category' })
    if ((await cat.inputValue().catch(() => '')) === '') {
      await cat.fill('Office')
      await page.getByRole('option', { name: /Office/ }).first().click().catch(() => undefined)
    }
    if (date !== null) {
      await d.getByLabel('Date paid').fill(date)
      await d.getByLabel('Date paid').press('Tab')
    }
    if (tax !== null) {
      const t = d.getByLabel(/input tax/i).first()
      if (!(await t.isVisible().catch(() => false))) await d.getByRole('button', { name: /input tax/i }).first().click().catch(() => undefined)
      await d.getByLabel(/input tax/i).first().fill(tax).catch(e => note({ kind: 'form-note', path: 'add expense', detail: `no input tax field: ${String(e).slice(0, 80)}` }))
    }
    await d.getByLabel('Detail').fill(`Hunt expense ${amount} ${date ?? ''} کاغذ 📎`).catch(() => undefined)
    await d.getByRole('button', { name: /Save expense|Try again/ }).click().catch(() => undefined)
    const o = await OUTCOME(page)
    const last = (await dbRows(`expenses?select=amount_pkr,input_tax_pkr,paid_on,description&description=like.Hunt*&order=created_at.desc&limit=1`)) as unknown[]
    note({ kind: 'form', role: 'admin', vp: 'w1366', path: 'add expense', detail: `amount=${JSON.stringify(amount)} date=${JSON.stringify(date)} tax=${JSON.stringify(tax)} -> ${JSON.stringify(o)} latest=${JSON.stringify(last)}` })
    await shot(page, `form_expense_a${amount}_d${date}_t${tax}`)
  }
  for (const a of AMOUNTS) await run(a, null)
  for (const d of DATES) await run('750', d)
  for (const t of ['-5', '2000', '1500.555']) await run('1000', null, t)
  await context.close()
})

test('Exchange rate, category, target, phone: edge values (admin)', async ({ browser }, info) => {
  test.setTimeout(600_000)
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  const w = new Watcher(page, { role: 'admin', vp: 'w1366' })
  for (const rate of ['0', '-1', '0.0000001', '281.123456789', '99999999999999', '1,234.5', 'abc']) {
    w.at(`exchange rate ${rate}`)
    await page.goto('/settings/exchange-rates')
    await settle(page)
    await page.getByLabel('Rate, PKR for 1 unit').fill(rate)
    const btn = page.getByRole('button', { name: 'Save rate' })
    const enabled = await btn.isEnabled()
    if (enabled) await btn.click()
    const o = await OUTCOME(page)
    note({ kind: 'form', role: 'admin', vp: 'w1366', path: 'exchange rate', detail: `rate=${rate} save-enabled=${enabled} -> ${JSON.stringify(o)}` })
    await shot(page, `form_rate_${rate}`)
  }
  for (const asOf of ['1/1/2200', '01/01/1990', 'tomorrow']) {
    w.at(`exchange rate as-of ${asOf}`)
    await page.goto('/settings/exchange-rates')
    await settle(page)
    await page.getByLabel('Rate, PKR for 1 unit').fill('280.5')
    await page.getByLabel('As of').fill(asOf)
    await page.getByLabel('As of').press('Tab')
    await page.getByRole('button', { name: 'Save rate' }).click().catch(() => undefined)
    const o = await OUTCOME(page)
    note({ kind: 'form', role: 'admin', vp: 'w1366', path: 'exchange rate as-of', detail: `asOf=${asOf} -> ${JSON.stringify(o)}` })
    await shot(page, `form_rate_asof_${asOf}`)
  }
  for (const name of ['', '   ', 'کرایہ دفتر', 'Hunt 🚕 taxi', 'x'.repeat(61), 'Office supplies & snacks', 'office SUPPLIES & snacks ', '<img src=x>']) {
    w.at(`category ${name}`)
    await page.goto('/settings/categories')
    await settle(page)
    // Categories are added from a dialog since the settings redesign on main: this probe's inline field may be gone.
    if ((await page.getByLabel('New category').count()) === 0) {
      note({ kind: 'form', role: 'admin', vp: 'w1366', path: 'category', detail: 'skipped: no inline "New category" field on this build' })
      break
    }
    await page.getByLabel('New category').fill(name)
    const typed = await page.getByLabel('New category').inputValue()
    await page.getByRole('form', { name: 'Add a category' }).getByRole('button', { name: /Add/ }).click()
    const o = await OUTCOME(page)
    note({ kind: 'form', role: 'admin', vp: 'w1366', path: 'category', detail: `name=${JSON.stringify(name).slice(0, 70)} kept=${typed.length} chars -> ${JSON.stringify(o)}` })
    await shot(page, `form_category_${name.slice(0, 20)}`)
  }
  for (const amt of ['-1', '0', '0.5', '1234567.891', '999999999999999', 'abc']) {
    w.at(`target ${amt}`)
    await page.goto('/settings/targets')
    await settle(page)
    const cell = page.getByRole('button', { name: / target: / }).first()
    await cell.click().catch(() => undefined)
    const input = page.getByLabel(/target in rupees/).first()
    if (!(await input.isVisible().catch(() => false))) {
      note({ kind: 'form-note', path: 'target', detail: 'could not open a target cell' })
      break
    }
    await input.fill(amt)
    await input.press('Enter')
    const o = await OUTCOME(page)
    note({ kind: 'form', role: 'admin', vp: 'w1366', path: 'target enter', detail: `amount=${amt} -> ${JSON.stringify(o)}` })
    await shot(page, `form_target_${amt}`)
    // the same value, but leave the field by clicking elsewhere (blur) instead of Enter
    await page.goto('/settings/targets')
    await settle(page)
    await page.getByRole('button', { name: / target: / }).first().click().catch(() => undefined)
    await page.getByLabel(/target in rupees/).first().fill(amt).catch(() => undefined)
    await page.locator('h1').first().click()
    const ob = await OUTCOME(page)
    note({ kind: 'form', role: 'admin', vp: 'w1366', path: 'target blur', detail: `amount=${amt} -> ${JSON.stringify(ob)}` })
  }
  for (const phone of ['+92 300 1234567', '۰۳۰۰۱۲۳۴۵۶۷', 'call me 📞', '1'.repeat(60)]) {
    w.at(`my phone ${phone}`)
    await page.goto('/settings/details')
    await settle(page)
    await page.getByLabel('Phone').fill(phone)
    await page.getByRole('button', { name: /Save/ }).click().catch(() => undefined)
    const o = await OUTCOME(page)
    note({ kind: 'form', role: 'admin', vp: 'w1366', path: 'my phone', detail: `phone=${JSON.stringify(phone)} -> ${JSON.stringify(o)}` })
  }
  await context.close()
})

test('Team: add person with edge names and emails (admin)', async ({ browser }, info) => {
  test.setTimeout(300_000)
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  const w = new Watcher(page, { role: 'admin', vp: 'w1366' })
  const cases: [string, string][] = [
    ['', ''],
    ['   ', 'nobody'],
    ['علی رضا', `hunt-urdu-${Date.now()}@test.invalid`],
    ['Hunt Emoji 😀', `HUNT-CASE-${Date.now()}@TEST.INVALID`],
    ['  Hunt Spaces  ', ` hunt-sp-${Date.now()}@test.invalid `],
    ['x'.repeat(101), `hunt-long-${Date.now()}@test.invalid`],
    ['Hunt Dup', 'sales@test.invalid'],
    ['Hunt Dup Case', 'SALES@test.invalid'],
  ]
  for (const [name, email] of cases) {
    w.at(`team add ${name.slice(0, 10)}`)
    await page.goto('/settings/team')
    await settle(page)
    await page.getByRole('button', { name: 'Add person' }).first().click()
    const d = page.getByRole('dialog', { name: 'Add person' })
    await d.getByLabel('Full name').fill(name)
    await d.getByLabel('Email').fill(email)
    await d.getByRole('button', { name: /Create|Add|Try again/ }).last().click()
    await page.waitForTimeout(2500)
    const o = await OUTCOME(page)
    note({ kind: 'form', role: 'admin', vp: 'w1366', path: 'team add', detail: `name=${JSON.stringify(name).slice(0, 40)} email=${JSON.stringify(email)} -> ${JSON.stringify(o)}` })
    await shot(page, `form_team_${name.slice(0, 12)}_${email.slice(0, 12)}`)
  }
  await context.close()
})

test('RFQ intake: Urdu and emoji items, odd quantities, past due date (sales)', async ({ browser }, info) => {
  test.setTimeout(300_000)
  for (const vkey of ['w1366', 'w375']) {
    const context = await contextAs(browser, info, 'sales', vp(vkey))
    const page = await context.newPage()
    const w = new Watcher(page, { role: 'sales', vp: vkey })
    w.at('/rfqs/new')
    await page.goto('/rfqs/new')
    await settle(page)
    await page.getByRole('combobox', { name: 'Company' }).fill(world.company.name)
    await page.getByRole('option', { name: new RegExp(world.tag) }).first().click().catch(() => undefined)
    const text = ['پریشر ٹرانسمیٹر 0-10 bar، 4 عدد', 'Flow meter 🌊 DN50 x 2', '  Level switch   , qty -3', `Valve ${'very long description '.repeat(20)} 1 no`, 'Cable 1.5mm 0.5 m', 'Gauge 9999999999 nos'].join('\n')
    await page.evaluate(t => {
      const dt = new DataTransfer()
      dt.setData('text/plain', t)
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, text)
    await page.waitForTimeout(1500)
    const rows: string[] = []
    const n = await page.getByRole('textbox', { name: /^Description of item \d+$/ }).count()
    for (let i = 1; i <= n; i++) rows.push(`${await page.getByRole('textbox', { name: `Description of item ${i}` }).inputValue()} || ${await page.getByRole('textbox', { name: `Quantity of item ${i}` }).inputValue().catch(() => '?')}`)
    note({ kind: 'form', role: 'sales', vp: vkey, path: 'intake paste', detail: `${n} rows: ${rows.join(' ## ').slice(0, 900)}` })
    recordLayout(w, await layout(page), 'intake after paste')
    await shot(page, `form_intake_${vkey}_pasted`, true)
    const due = page.getByLabel('Quotation due')
    if (await due.isVisible().catch(() => false)) {
      await due.fill('01/01/2020')
      await due.press('Tab')
    }
    await page.getByRole('button', { name: 'Save without asking' }).click().catch(() => undefined)
    const o = await OUTCOME(page)
    note({ kind: 'form', role: 'sales', vp: vkey, path: 'intake save', detail: `${JSON.stringify(o)} url=${page.url()}` })
    await shot(page, `form_intake_${vkey}_saved`, true)
    await context.close()
  }
})
