// Integration test for the admin-users Edge Function against the local CI stack.
// Needs: `supabase start`, `supabase db reset` (seed fixtures) and `supabase functions serve admin-users`.
// Env: API_URL, ANON_KEY, SERVICE_ROLE_KEY (from `supabase status -o env`), optional FN_URL.
// Run: node --test supabase/functions/admin-users/integration.test.mjs
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { createClient } from '@supabase/supabase-js'

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:54321'
const ANON_KEY = process.env.ANON_KEY
const SERVICE_KEY = process.env.SERVICE_ROLE_KEY
const FN_URL = process.env.FN_URL ?? `${API_URL}/functions/v1/admin-users`
const FIXTURE_PASSWORD = 'fixture-only-password'
const ADMIN_ID = 'a0000000-0000-4000-8000-000000000001'
const SALES_ID = 'a0000000-0000-4000-8000-000000000002'

assert.ok(ANON_KEY && SERVICE_KEY, 'ANON_KEY and SERVICE_ROLE_KEY must be set (supabase status -o env)')

const anon = () => createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

async function signIn(email, password) {
  const client = anon()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  return { client, session: data?.session ?? null, error }
}

async function call(token, body, headers = {}) {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON_KEY, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // keep text for the assertion message
  }
  return { status: res.status, json, text }
}

async function serviceGet(path) {
  const res = await fetch(`${API_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` } })
  assert.equal(res.status, 200, `GET ${path}`)
  return res.json()
}

describe('admin-users', () => {
  let adminToken
  let salesToken

  before(async () => {
    // The function may still be booting: wait until it answers.
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(FN_URL, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } })
        if (r.status < 500) break
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
    adminToken = (await signIn('admin@test.invalid', FIXTURE_PASSWORD)).session?.access_token
    salesToken = (await signIn('sales@test.invalid', FIXTURE_PASSWORD)).session?.access_token
    assert.ok(adminToken && salesToken, 'fixture users can sign in')
  })

  it('refuses a request with no admin token', async () => {
    const r = await call(null, { action: 'list' }, { authorization: `Bearer ${ANON_KEY}` })
    assert.ok(r.status === 401 || r.status === 403, `got ${r.status}`)
  })

  it('a non-admin gets 403 on list, create and set_role', async () => {
    for (const body of [
      { action: 'list' },
      { action: 'create', name: 'Mallory', email: 'mallory@test.invalid', role: 'admin' },
      { action: 'set_role', user_id: SALES_ID, role: 'admin' },
    ]) {
      const r = await call(salesToken, body)
      assert.equal(r.status, 403, `${body.action}: ${r.text}`)
    }
    const rows = await serviceGet(`users?id=eq.${SALES_ID}&select=role`)
    assert.equal(rows[0].role, 'sales', 'sales did not promote themselves')
  })

  it('an origin outside the allow-list is refused', async () => {
    const r = await call(adminToken, { action: 'list' }, { Origin: 'https://evil.example' })
    assert.equal(r.status, 403)
  })

  it('the admin lists people with emails', async () => {
    const r = await call(adminToken, { action: 'list' })
    assert.equal(r.status, 200, r.text)
    const admin = r.json.users.find((u) => u.id === ADMIN_ID)
    assert.equal(admin.email, 'admin@test.invalid')
    assert.equal(admin.role, 'admin')
  })

  it('the last admin cannot be demoted or deactivated', async () => {
    const demote = await call(adminToken, { action: 'set_role', user_id: ADMIN_ID, role: 'sales' })
    assert.equal(demote.status, 409, demote.text)
    assert.equal(demote.json.code, 'last_admin')
    const deact = await call(adminToken, { action: 'deactivate', user_id: ADMIN_ID })
    assert.equal(deact.status, 409, deact.text)
    const rows = await serviceGet(`users?id=eq.${ADMIN_ID}&select=role,deactivated_at`)
    assert.deepEqual(rows[0], { role: 'admin', deactivated_at: null })
  })

  it('the database also refuses a direct write that would remove the last admin', async () => {
    const res = await fetch(`${API_URL}/rest/v1/users?id=eq.${ADMIN_ID}`, {
      method: 'PATCH',
      headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'sales' }),
    })
    assert.equal(res.status, 400)
    assert.match(await res.text(), /at least one active admin/)
  })

  it('create, sign in, reset, deactivate, reactivate, with audit rows and no password in them', async () => {
    const email = `new-${Date.now()}@test.invalid`
    const created = await call(adminToken, { action: 'create', name: 'New Engineer', email, role: 'engineer' })
    assert.equal(created.status, 200, created.text)
    const { password } = created.json
    const id = created.json.user.id
    assert.ok(password && password.length >= 12)

    const first = await signIn(email, password)
    assert.ok(first.session, `new user signs in: ${first.error?.message}`)
    const mine = await first.client.from('users').select('role').eq('id', id)
    assert.deepEqual(mine.data, [{ role: 'engineer' }])

    // reset: old password stops working, new one works
    const reset = await call(adminToken, { action: 'reset_password', user_id: id })
    assert.equal(reset.status, 200, reset.text)
    const newPassword = reset.json.password
    assert.notEqual(newPassword, password)
    assert.ok((await signIn(email, password)).error, 'old password rejected')
    const second = await signIn(email, newPassword)
    assert.ok(second.session, 'new password accepted')

    // deactivate: the open session loses all data at once, and sign-in is refused
    const deact = await call(adminToken, { action: 'deactivate', user_id: id })
    assert.equal(deact.status, 200, deact.text)
    const after = await second.client.from('users').select('role').eq('id', id)
    assert.deepEqual(after.data ?? [], [], 'deactivated user sees nothing')
    assert.ok((await signIn(email, newPassword)).error, 'deactivated user cannot sign in')

    // reactivate
    const react = await call(adminToken, { action: 'reactivate', user_id: id })
    assert.equal(react.status, 200, react.text)
    assert.ok((await signIn(email, newPassword)).session, 'reactivated user signs in again')

    // set_role
    const role = await call(adminToken, { action: 'set_role', user_id: id, role: 'sales' })
    assert.equal(role.status, 200, role.text)

    // audit: one row per action, acting admin as changed_by, never a password
    const audit = await serviceGet(`audit_log?table_name=eq.users&record_id=eq.${id}&order=changed_at.asc&select=action,changed_by,old_value,new_value`)
    assert.equal(audit.length, 5, JSON.stringify(audit))
    assert.ok(audit.every((a) => a.changed_by === ADMIN_ID))
    assert.deepEqual(audit.map((a) => a.action), ['insert', 'update', 'update', 'update', 'update'])
    const dump = JSON.stringify(audit)
    assert.ok(!dump.includes(password) && !dump.includes(newPassword), 'no password in the audit log')
  })
})
