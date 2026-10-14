// Review screenshots for A04 (Team) and A06 (Company profile), taken against the approved mockup
// docs/design/mockups/g2-login-team-settings.html (screens/login-team-settings-*.png).
// No database: the dev-only ?devRole= session fakes sign-in, and every network call the screens make
// (the admin-users function, the company_profile table) is answered by this script, so the numbers on
// screen are mock data. The real behaviour is covered by e2e/auth/team.spec.ts on the CI stack.
//
//   VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=review-only npx vite --port 5199
//   node scripts/review-screenshots-a04-a06.mjs [outDir] [baseUrl]
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const out = process.argv[2] ?? 'docs/design/review/a04-a06'
const base = process.argv[3] ?? 'http://localhost:5199'
mkdirSync(out, { recursive: true })

const person = (id, name, role, job, extra = {}) => ({
  id,
  name,
  email: `${name.split(' ')[0].toLowerCase()}@qtech.example`,
  role,
  job_title: job,
  deactivated_at: null,
  created_at: '2026-01-01T00:00:00Z',
  ...extra,
})

function team() {
  return [
    person('dev-admin', 'Farhan Mirza', 'admin', 'Director'),
    person('u2', 'Ayesha Rana', 'sales', 'Sales engineer'),
    person('u3', 'Usman Tariq', 'sales', 'Sales manager'),
    person('u4', 'Faizan Ahmed', 'engineer', 'Commissioning engineer'),
    person('u5', 'Naveed Akhtar', 'engineer', 'Service engineer'),
    person('u6', 'Saad Hussain', 'sales', 'Sales executive', { deactivated_at: '2026-02-01T00:00:00Z' }),
  ]
}

const FULL = {
  legal_name: 'Q-Tech Solutions (Private) Limited',
  address: 'Plot 14, Sector 12-B, Korangi Industrial Area,\nKarachi 74900, Pakistan',
  phone: '+92 21 3555 0188',
  email: 'sales@qtech.example',
  website: 'www.qtech.example',
  ntn: '3827149-5',
  strn: '17-00-3827-149-46',
  bank_name: 'Indus Commercial Bank, Korangi branch',
  bank_account_title: 'Q-Tech Solutions (Private) Limited',
  bank_iban: 'PK36 INDC 0000 0012 3456 7891',
  quotation_validity_days: 45,
  quotation_terms:
    '1. Prices are in PKR and exclusive of sales tax unless stated.\n2. Delivery is ex-works Karachi unless stated.\n3. Payment: advance with order, balance against delivery.\n4. Warranty is as per the manufacturer’s terms.',
  po_terms: '1. Please acknowledge this order within 2 working days.\n2. Goods must match the specification and part numbers listed.\n3. Quote our PO number on every challan and invoice.',
  updated_at: '2026-10-01T00:00:00Z',
}
const EMPTY = Object.fromEntries(Object.keys(FULL).map(k => [k, k === 'quotation_validity_days' ? 30 : k === 'updated_at' ? FULL.updated_at : null]))

const cors = origin => ({
  'access-control-allow-origin': origin ?? '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, accept, prefer, accept-profile, content-profile, x-supabase-api-version',
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
  vary: 'Origin',
})

async function install(page, state) {
  await page.route('**/functions/v1/admin-users', async route => {
    const req = route.request()
    const h = cors(req.headers().origin)
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h })
    const body = req.postDataJSON()
    const json = (status, data) => route.fulfill({ status, headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(data) })
    if (body.action === 'list') return json(200, { users: state.team })
    if (body.action === 'create') {
      if (body.email === 'ayesha@qtech.example') return json(409, { error: 'Someone already has that email address.', code: 'email_taken' })
      return json(200, { user: { id: 'new', name: body.name, email: body.email, role: body.role, job_title: body.job_title ?? null }, password: 'Vk7xmQ3pRt9wHn2e' })
    }
    if (body.action === 'reset_password') return json(200, { user_id: body.user_id, password: 'Vk7xmQ3pRt9wHn2e' })
    return json(200, { user_id: body.user_id })
  })
  await page.route('**/rest/v1/company_profile**', async route => {
    const req = route.request()
    const h = cors(req.headers().origin)
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h })
    if (req.method() === 'PATCH') return route.fulfill({ status: 200, headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify([{ ...state.profile, ...req.postDataJSON() }]) })
    return route.fulfill({ status: 200, headers: { ...h, 'content-type': 'application/vnd.pgrst.object+json' }, body: JSON.stringify(state.profile) })
  })
}

const browser = await chromium.launch({ channel: 'chrome' })
let count = 0

async function run(name, { role = 'admin', path, w = 1440, h = 900, mobile = false, state = {}, steps, full = false }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile, locale: 'en-GB', timezoneId: 'Asia/Karachi', reducedMotion: 'reduce' })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base })
  const page = await ctx.newPage()
  await install(page, { team: team(), profile: FULL, ...state })
  await page.goto(`${base}${path}?devRole=${role}`)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)
  if (steps) await steps(page)
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full })
  count++
  await ctx.close()
}

const menu = (page, name, item) => async () => {
  await page.getByRole('button', { name: `Actions for ${name}` }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

// ---- Team, desktop -----------------------------------------------------------------------------
await run('a04-team-1440', { path: '/settings/team' })
await run('a04-team-row-menu-1440', { path: '/settings/team', steps: p => p.getByRole('button', { name: 'Actions for Ayesha Rana' }).click() })
await run('a04-account-menu-1440', { path: '/settings/team', steps: p => p.getByRole('button', { name: /Account menu/ }).click() })
await run('a04-add-person-1440', {
  path: '/settings/team',
  steps: async p => {
    await p.getByRole('button', { name: 'Add person' }).click()
    await p.getByLabel(/Full name/).fill('Hira Siddiqui')
    await p.getByLabel(/Email/).fill('hira@qtech.example')
    await p.getByLabel('Job title').fill('Sales coordinator')
  },
})
await run('a04-add-person-email-taken-1440', {
  path: '/settings/team',
  steps: async p => {
    await p.getByRole('button', { name: 'Add person' }).click()
    await p.getByLabel(/Full name/).fill('Hira Siddiqui')
    await p.getByLabel(/Email/).fill('ayesha@qtech.example')
    await p.getByLabel('Job title').fill('Sales coordinator')
    await p.getByRole('button', { name: 'Create account' }).click()
    await p.getByText(/already uses this email/).waitFor()
  },
})
const created = async p => {
  await p.getByRole('button', { name: 'Add person' }).click()
  await p.getByLabel(/Full name/).fill('Hira Siddiqui')
  await p.getByLabel(/Email/).fill('hira@qtech.example')
  await p.getByRole('button', { name: 'Create account' }).click()
  await p.getByRole('dialog', { name: 'Account created' }).waitFor()
}
await run('a04-password-shown-once-1440', { path: '/settings/team', steps: created })
await run('a04-password-copied-1440', {
  path: '/settings/team',
  steps: async p => {
    await created(p)
    await p.getByRole('button', { name: 'Copy', exact: true }).click()
    await p.getByRole('button', { name: 'Copied' }).waitFor()
  },
})
await run('a04-edit-job-title-1440', { path: '/settings/team', steps: async p => void (await menu(p, 'Ayesha Rana', 'Edit job title')()) })
await run('a04-change-role-1440', { path: '/settings/team', steps: async p => void (await menu(p, 'Ayesha Rana', 'Change role')()) })
await run('a04-change-role-only-admin-1440', { path: '/settings/team', steps: async p => void (await menu(p, 'Farhan Mirza', 'Change role')()) })
await run('a04-reset-confirm-1440', { path: '/settings/team', steps: async p => void (await menu(p, 'Ayesha Rana', 'Reset password')()) })
await run('a04-reset-shown-1440', {
  path: '/settings/team',
  steps: async p => {
    await menu(p, 'Ayesha Rana', 'Reset password')()
    await p.getByRole('button', { name: 'Reset password' }).click()
    await p.getByRole('dialog', { name: 'Password reset' }).waitFor()
  },
})
await run('a04-deactivate-1440', { path: '/settings/team', steps: async p => void (await menu(p, 'Usman Tariq', 'Deactivate')()) })
await run('a04-deactivate-only-admin-1440', { path: '/settings/team', steps: async p => void (await menu(p, 'Farhan Mirza', 'Deactivate')()) })
await run('a04-reactivate-1440', { path: '/settings/team', steps: p => p.getByRole('button', { name: 'Reactivate Saad Hussain' }).click() })
await run('a04-deactivated-toast-1440', {
  path: '/settings/team',
  steps: async p => {
    await menu(p, 'Usman Tariq', 'Deactivate')()
    await p.getByRole('button', { name: 'Deactivate Usman' }).click()
    await p.getByText('Usman Tariq deactivated').waitFor()
  },
})
await run('a04-team-loading-error-1440', {
  path: '/settings/team',
  state: { team: null },
  steps: async p => {
    await p.unroute('**/functions/v1/admin-users')
    await p.route('**/functions/v1/admin-users', r =>
      r.request().method() === 'OPTIONS'
        ? r.fulfill({ status: 204, headers: cors(r.request().headers().origin) })
        : r.fulfill({ status: 500, headers: { ...cors(r.request().headers().origin), 'content-type': 'application/json' }, body: '{"error":"Something went wrong. Try again."}' }),
    )
    await p.reload()
    await p.getByText('Could not load the team').waitFor()
  },
})

// ---- Team, phone and no access ---------------------------------------------------------------------
await run('a04-team-375', { path: '/settings/team', w: 375, h: 812, mobile: true })
await run('a04-add-person-375', {
  path: '/settings/team',
  w: 375,
  h: 812,
  mobile: true,
  steps: p => p.getByRole('button', { name: 'Add person' }).click(),
})
await run('a04-password-shown-once-375', { path: '/settings/team', w: 375, h: 812, mobile: true, steps: created })
await run('a04-sales-no-access-1440', { role: 'sales', path: '/settings/team' })

// ---- Company profile -----------------------------------------------------------------------------------
await run('a06-company-incomplete-1440', { path: '/settings/company', state: { profile: EMPTY }, full: true })
await run('a06-company-complete-unsaved-1440', {
  path: '/settings/company',
  full: true,
  steps: async p => {
    await p.getByLabel('Quotation validity').fill('60')
  },
})
await run('a06-company-saved-toast-1440', {
  path: '/settings/company',
  steps: async p => {
    await p.getByLabel('Quotation validity').fill('60')
    await p.getByRole('button', { name: 'Save changes' }).click()
    await p.getByText('Company profile saved').waitFor()
  },
})
await run('a06-company-read-only-sales-1440', { role: 'sales', path: '/settings/company', full: true })
await run('a06-company-read-only-incomplete-1440', { role: 'engineer', path: '/settings/company', state: { profile: EMPTY } })
await run('a06-company-375', { path: '/settings/company', w: 375, h: 812, mobile: true, state: { profile: EMPTY }, full: true })
await run('a06-company-read-only-375', { role: 'sales', path: '/settings/company', w: 375, h: 812, mobile: true, full: true })

await browser.close()
console.log('wrote', count, 'screenshots to', out)
