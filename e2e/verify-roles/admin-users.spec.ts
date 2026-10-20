import { expect, test } from '@playwright/test'
import { API_URL, ANON_KEY } from '../support/stack'
import { parseOrigins } from '../../supabase/functions/admin-users/lib.ts'
import { SERVICE_KEY, tokenFor, type Persona } from './lib'

/*
 * The admin-users Edge Function (supabase/functions/admin-users), served on the e2e stack by `supabase functions serve
 * admin-users --no-verify-jwt` (e2e.yml), exactly as the Team screen calls it. Three things:
 *   1. only an active admin gets anything: every other persona and every kind of bad token is refused, for every action;
 *   2. CORS: a browser on another origin is refused (no Access-Control-Allow-Origin, no wildcard, no credentials), and in
 *      production only the production origin may call it;
 *   3. input validation: malformed bodies, unknown actions, bad ids, roles, names, emails and lengths get a 4xx with a plain
 *      message and change nothing; no response is cacheable or leaks internals.
 * CI-local only: the fixture users and test users created here (@test.invalid).
 */
const FN = `${API_URL}/functions/v1/admin-users`
const APP_ORIGIN = 'http://127.0.0.1:4173'
const PROD_ORIGIN = 'https://qtech-crm.vercel.app'

async function call(token: string | null, body: unknown, headers: Record<string, string> = {}, method = 'POST') {
  const res = await fetch(FN, {
    method,
    headers: {
      apikey: ANON_KEY,
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  })
  const text = await res.text()
  let json: Record<string, unknown> | null = null
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    json = null
  }
  return { status: res.status, json, text, headers: res.headers }
}

const token = async (p: Persona) => (await tokenFor(p))?.access_token ?? null


test.beforeAll(async () => {
  test.skip(!SERVICE_KEY, 'needs SERVICE_ROLE_KEY from the local stack')
  for (let i = 0; i < 60; i++) {
    const r = await fetch(FN, { method: 'OPTIONS', headers: { Origin: APP_ORIGIN } }).catch(() => null)
    if (r && r.status === 204) return
    await new Promise(res => setTimeout(res, 1000))
  }
  throw new Error('admin-users is not being served on the stack')
})

const ACTIONS = [
  { action: 'list' },
  { action: 'create', name: 'Mallory', email: 'mallory-verify@test.invalid', role: 'admin' },
  { action: 'set_role', user_id: 'a0000000-0000-4000-8000-000000000003', role: 'admin' },
  { action: 'set_job_title', user_id: 'a0000000-0000-4000-8000-000000000003', job_title: 'Owner' },
  { action: 'reset_password', user_id: 'a0000000-0000-4000-8000-000000000001' },
  { action: 'deactivate', user_id: 'a0000000-0000-4000-8000-000000000001' },
  { action: 'reactivate', user_id: 'a0000000-0000-4000-8000-000000000004' },
]

test('only an active admin: every other persona and every bad token is refused on every action', async () => {
  const callers: { who: string; token: string | null; expect: number[] }[] = [
    { who: 'sales', token: await token('sales'), expect: [403] },
    { who: 'engineer', token: await token('engineer'), expect: [403] },
    { who: 'deactivated', token: await token('deactivated'), expect: [403] },
    { who: 'no users row', token: await token('norole'), expect: [403] },
    { who: 'deleted account (still-valid token)', token: await token('ghost'), expect: [401, 403] },
    { who: 'no Authorization header', token: null, expect: [401] },
    { who: 'the anon key as a bearer', token: ANON_KEY, expect: [401] },
    { who: 'the service-role key as a bearer', token: SERVICE_KEY, expect: [401, 403] },
    { who: 'a garbage token', token: 'not.a.jwt', expect: [401] },
    { who: 'an admin token with its signature cut off', token: ((await token('admin')) ?? '').split('.').slice(0, 2).join('.') + '.AAAA', expect: [401] },
  ]
  for (const c of callers) {
    for (const body of ACTIONS) {
      const r = await call(c.token, body)
      expect.soft(c.expect, `${c.who} -> ${body.action}: ${r.status} ${r.text.slice(0, 100)}`).toContain(r.status)
      expect.soft(r.text, `${c.who} -> ${body.action}: no password in a refusal`).not.toMatch(/"password"/)
    }
  }
  // Nothing changed: the engineer is still an engineer, the admin still active, nobody called Mallory exists.
  const admin = await call(await token('admin'), { action: 'list' })
  expect(admin.status).toBe(200)
  const users = (admin.json?.users ?? []) as { id: string; role: string; deactivated_at: string | null; email: string | null }[]
  expect(users.find(u => u.id === 'a0000000-0000-4000-8000-000000000003')?.role).toBe('engineer')
  expect(users.find(u => u.id === 'a0000000-0000-4000-8000-000000000001')?.deactivated_at).toBeNull()
  expect(users.find(u => u.email === 'mallory-verify@test.invalid')).toBeUndefined()
})

// On the LOCAL stack the API gateway (Kong) answers every preflight itself and adds "Access-Control-Allow-Origin: *" to
// every function response, so headers here say nothing about production; the function's own decision is its status and
// body. The gateway headers are recorded as an annotation.
test('CORS: a browser on another origin is refused by the function itself, even with an admin token', async () => {
  const adminToken = await token('admin')
  const seen: string[] = []
  for (const origin of ['https://evil.example', 'null', 'http://127.0.0.1:4174', `${APP_ORIGIN}.evil.example`, 'https://qtech-crm.vercel.app.evil.example']) {
    const post = await call(adminToken, { action: 'list' }, { Origin: origin })
    expect.soft(post.status, `POST from ${origin} with an admin token`).toBe(403)
    expect.soft(post.text, `POST from ${origin}: no data`).not.toContain('"users"')
    const reset = await call(adminToken, { action: 'reset_password', user_id: 'a0000000-0000-4000-8000-000000000002' }, { Origin: origin })
    expect.soft(reset.status, `reset_password from ${origin}`).toBe(403)
    expect.soft(reset.text, `reset_password from ${origin}: no password`).not.toMatch(/"password"/)
    seen.push(`${origin}: allow-origin ${post.headers.get('access-control-allow-origin')}`)
  }
  test.info().annotations.push({ type: 'local gateway CORS headers (not production)', description: seen.join(' ; ') })
  const ok = await call(adminToken, { action: 'list' }, { Origin: APP_ORIGIN })
  expect(ok.status, 'the app origin works').toBe(200)
  expect(ok.headers.get('access-control-allow-credentials')).toBeNull()
})

test('BUG-RV-05: in production only the production origin is allowed (localhost dev origins are always added)', async () => {
  test.fail(true, 'BUG-RV-05: parseOrigins() always adds http://localhost:5173, 127.0.0.1:5173, :4173 to ALLOWED_ORIGINS (lib.ts DEV_ORIGINS)')
  // What the deployed function would allow with the production secret (deploy-functions.yml sets ALLOWED_ORIGINS).
  expect([...parseOrigins(PROD_ORIGIN)]).toEqual([PROD_ORIGIN])
})

test('input validation: malformed requests get a 4xx and a plain message, and change nothing', async () => {
  const t = await token('admin')
  const long = 'x'.repeat(101)
  const cases: { label: string; body: unknown; status: number }[] = [
    { label: 'not JSON', body: '{action: list', status: 400 },
    { label: 'a JSON array', body: [{ action: 'list' }], status: 400 },
    { label: 'a JSON string', body: 'list', status: 400 },
    { label: 'null', body: null, status: 400 },
    { label: 'no action', body: {}, status: 400 },
    { label: 'unknown action', body: { action: 'drop_table' }, status: 400 },
    { label: 'action with another case', body: { action: 'LIST' }, status: 400 },
    { label: 'create: empty name', body: { action: 'create', name: '   ', email: 'v1@test.invalid', role: 'sales' }, status: 400 },
    { label: 'create: name over 100', body: { action: 'create', name: long, email: 'v2@test.invalid', role: 'sales' }, status: 400 },
    { label: 'create: bad email', body: { action: 'create', name: 'V', email: 'not-an-email', role: 'sales' }, status: 400 },
    { label: 'create: email over 254', body: { action: 'create', name: 'V', email: `${'a'.repeat(250)}@test.invalid`, role: 'sales' }, status: 400 },
    { label: 'create: unknown role', body: { action: 'create', name: 'V', email: 'v3@test.invalid', role: 'superadmin' }, status: 400 },
    { label: 'create: role in capitals', body: { action: 'create', name: 'V', email: 'v4@test.invalid', role: 'Admin' }, status: 400 },
    { label: 'create: role as an array', body: { action: 'create', name: 'V', email: 'v5@test.invalid', role: ['admin'] }, status: 400 },
    { label: 'create: job title over 100', body: { action: 'create', name: 'V', email: 'v6@test.invalid', role: 'sales', job_title: long }, status: 400 },
    { label: 'set_role: user_id not a uuid', body: { action: 'set_role', user_id: "1' or '1'='1", role: 'sales' }, status: 400 },
    { label: 'set_role: unknown user', body: { action: 'set_role', user_id: '00000000-0000-4000-8000-0000000000ff', role: 'sales' }, status: 404 },
    { label: 'set_role: unknown role', body: { action: 'set_role', user_id: 'a0000000-0000-4000-8000-000000000003', role: 'root' }, status: 400 },
    { label: 'set_job_title: a number', body: { action: 'set_job_title', user_id: 'a0000000-0000-4000-8000-000000000003', job_title: 42 }, status: 400 },
    { label: 'set_job_title: over 100', body: { action: 'set_job_title', user_id: 'a0000000-0000-4000-8000-000000000003', job_title: long }, status: 400 },
    { label: 'reset_password: no user_id', body: { action: 'reset_password' }, status: 400 },
    { label: 'deactivate: user_id as an object', body: { action: 'deactivate', user_id: { id: 'a0000000-0000-4000-8000-000000000002' } }, status: 400 },
    { label: 'reactivate: no user_id', body: { action: 'reactivate' }, status: 400 },
  ]
  for (const c of cases) {
    const r = await call(t, c.body)
    expect.soft(r.status, `${c.label}: ${r.text.slice(0, 120)}`).toBe(c.status)
    expect.soft(typeof r.json?.error, `${c.label}: a plain error message`).toBe('string')
    expect.soft(r.text, `${c.label}: no internals`).not.toMatch(/stack|at [A-Za-z]+ \(|postgres|supabase\.co|SERVICE|sb_secret/i)
    expect.soft(r.headers.get('cache-control'), `${c.label}: never cached`).toBe('no-store')
  }
  const wrongMethod = await call(t, null, {}, 'GET')
  expect(wrongMethod.status, 'GET is not allowed').toBe(405)
  // Nothing was created by any of them.
  const list = await call(t, { action: 'list' })
  const emails = ((list.json?.users ?? []) as { email: string | null }[]).map(u => u.email ?? '')
  expect(emails.filter(e => /^v\d@test\.invalid$/.test(e))).toEqual([])
  // A caller-chosen password is ignored: the function always generates one.
  const created = await call(t, { action: 'create', name: 'Verify Person', email: `verify-${Date.now()}@test.invalid`, role: 'engineer', password: 'chosen-by-caller' })
  expect(created.status).toBe(200)
  expect(created.json?.password).not.toBe('chosen-by-caller')
  expect(String(created.json?.password ?? '')).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/)
  expect(created.headers.get('cache-control')).toBe('no-store')
})
