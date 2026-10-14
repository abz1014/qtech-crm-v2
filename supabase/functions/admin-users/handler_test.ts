import { assert, assertEquals, assertMatch, assertNotEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import { bearerToken, generatePassword, parseOrigins, validEmail } from './lib.ts'
import type { AuditRow, Profile, Role, Store } from './types.ts'

const ADMIN = '00000000-0000-4000-8000-000000000001'
const ADMIN2 = '00000000-0000-4000-8000-000000000002'
const SALES = '00000000-0000-4000-8000-000000000003'
const GONE = '00000000-0000-4000-8000-000000000004'
const ORIGIN = 'http://localhost:5173'

function profile(id: string, role: Role, deactivated = false): Profile {
  return { id, name: `User ${id.slice(-1)}`, role, job_title: null, deactivated_at: deactivated ? '2026-01-01T00:00:00Z' : null, created_at: '2026-01-01T00:00:00Z' }
}

/** In-memory Store. Tokens are "tok-<user id>". */
function fakeStore(profiles: Profile[]) {
  const rows = new Map(profiles.map((p) => [p.id, { ...p }]))
  const calls: string[] = []
  const audits: AuditRow[] = []
  const emails = new Map<string, string>(profiles.map((p) => [p.id, `${p.id.slice(-1)}@x.test`]))
  const state = { failProfileInsert: false, failAudit: false, banned: new Set<string>(), passwords: new Map<string, string>() }
  const store: Store = {
    authenticate: (t) => Promise.resolve(t.startsWith('tok-') ? t.slice(4) : null),
    getProfile: (id) => Promise.resolve(rows.get(id) ? { ...rows.get(id)! } : null),
    countActiveAdmins: () => Promise.resolve([...rows.values()].filter((r) => r.role === 'admin' && !r.deactivated_at).length),
    createAuthUser: (email, password) => {
      calls.push('createAuthUser')
      if ([...emails.values()].includes(email)) return Promise.resolve({ error: 'exists', conflict: true })
      const id = '10000000-0000-4000-8000-000000000001'
      emails.set(id, email)
      state.passwords.set(id, password)
      return Promise.resolve({ id })
    },
    deleteAuthUser: (id) => {
      calls.push('deleteAuthUser')
      emails.delete(id)
      return Promise.resolve()
    },
    insertProfile: (p) => {
      if (state.failProfileInsert) return Promise.resolve('boom')
      rows.set(p.id, { ...p, deactivated_at: null, created_at: 'now' })
      return Promise.resolve(null)
    },
    updateProfile: (id, patch) => {
      rows.set(id, { ...rows.get(id)!, ...patch })
      return Promise.resolve(null)
    },
    setBan: (id, banned) => {
      calls.push(banned ? 'ban' : 'unban')
      if (banned) state.banned.add(id)
      else state.banned.delete(id)
      return Promise.resolve(null)
    },
    setPassword: (id, pw) => {
      state.passwords.set(id, pw)
      return Promise.resolve(null)
    },
    revokeSessions: () => {
      calls.push('revoke')
      return Promise.resolve(null)
    },
    listProfiles: () => Promise.resolve([...rows.values()]),
    listEmails: () => Promise.resolve(emails),
    writeAudit: (row) => {
      if (state.failAudit) return Promise.resolve('audit down')
      audits.push(row)
      return Promise.resolve(null)
    },
  }
  return { store, rows, calls, audits, state }
}

function setup(extra: Profile[] = []) {
  const f = fakeStore([profile(ADMIN, 'admin'), profile(SALES, 'sales'), profile(GONE, 'sales', true), ...extra])
  const handler = createHandler({ store: f.store, allowedOrigins: parseOrigins(''), generatePassword: () => 'Generated-Pass-1234' })
  return { ...f, handler }
}

function call(handler: (r: Request) => Promise<Response>, body: unknown, as: string | null = ADMIN, init: RequestInit = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', Origin: ORIGIN }
  if (as) headers.Authorization = `Bearer tok-${as}`
  return handler(new Request('http://fn/admin-users', { method: 'POST', headers, body: JSON.stringify(body), ...init }))
}

Deno.test('rejects a missing or invalid token with 401', async () => {
  const { handler } = setup()
  assertEquals((await call(handler, { action: 'list' }, null)).status, 401)
  const bad = await handler(
    new Request('http://fn/', { method: 'POST', headers: { Authorization: 'Bearer garbage' }, body: '{"action":"list"}' }),
  )
  assertEquals(bad.status, 401)
})

Deno.test('a non-admin gets 403 on every action', async () => {
  const { handler, rows } = setup()
  for (const action of ['list', 'create', 'reset_password', 'set_role', 'deactivate', 'reactivate']) {
    const res = await call(handler, { action, user_id: ADMIN, role: 'sales', name: 'N', email: 'n@x.test' }, SALES)
    assertEquals(res.status, 403, action)
  }
  assertEquals(rows.get(ADMIN)!.role, 'admin')
})

Deno.test('a deactivated admin gets 403', async () => {
  const { handler } = setup([profile(ADMIN2, 'admin', true)])
  assertEquals((await call(handler, { action: 'list' }, ADMIN2)).status, 403)
})

Deno.test('create returns the generated password once and audits without it', async () => {
  const { handler, audits, rows } = setup()
  const res = await call(handler, { action: 'create', name: ' New Person ', email: 'New@Qtech.test', role: 'engineer', job_title: 'Site lead' })
  assertEquals(res.status, 200)
  assertEquals(res.headers.get('Cache-Control'), 'no-store')
  const json = await res.json()
  assertEquals(json.password, 'Generated-Pass-1234')
  assertEquals(json.user.email, 'new@qtech.test')
  assertEquals(rows.get(json.user.id)!.name, 'New Person')
  assertEquals(audits.length, 1)
  assertEquals(audits[0].changed_by, ADMIN)
  assertEquals(audits[0].action, 'insert')
  assertEquals(audits[0].record_id, json.user.id)
  assert(!JSON.stringify(audits).includes('Generated-Pass'), 'password must not be in the audit row')
})

Deno.test('create validates input and reports a duplicate email as 409', async () => {
  const { handler } = setup()
  assertEquals((await call(handler, { action: 'create', name: '', email: 'a@b.test', role: 'sales' })).status, 400)
  assertEquals((await call(handler, { action: 'create', name: 'A', email: 'nope', role: 'sales' })).status, 400)
  assertEquals((await call(handler, { action: 'create', name: 'A', email: 'a@b.test', role: 'boss' })).status, 400)
  const dup = await call(handler, { action: 'create', name: 'A', email: `${ADMIN.slice(-1)}@x.test`, role: 'sales' })
  assertEquals(dup.status, 409)
})

Deno.test('create rolls back the auth user when the profile insert fails', async () => {
  const { handler, calls, state, audits } = setup()
  state.failProfileInsert = true
  const res = await call(handler, { action: 'create', name: 'A', email: 'a@b.test', role: 'sales' })
  assertEquals(res.status, 500)
  assertEquals(calls, ['createAuthUser', 'deleteAuthUser'])
  assertEquals(audits.length, 0)
})

Deno.test('reset_password sets a new password, returns it, audits without it', async () => {
  const { handler, state, audits } = setup()
  const res = await call(handler, { action: 'reset_password', user_id: SALES })
  assertEquals(res.status, 200)
  assertEquals((await res.json()).password, 'Generated-Pass-1234')
  assertEquals(state.passwords.get(SALES), 'Generated-Pass-1234')
  assertEquals(audits[0].new_value, { event: 'reset_password' })
  assert(!JSON.stringify(audits).includes('Generated-Pass'))
})

Deno.test('reset_password for an unknown or malformed id', async () => {
  const { handler } = setup()
  assertEquals((await call(handler, { action: 'reset_password', user_id: 'x' })).status, 400)
  assertEquals((await call(handler, { action: 'reset_password', user_id: '20000000-0000-4000-8000-000000000009' })).status, 404)
})

Deno.test('set_role changes the role and audits old and new', async () => {
  const { handler, rows, audits } = setup()
  const res = await call(handler, { action: 'set_role', user_id: SALES, role: 'engineer' })
  assertEquals(res.status, 200)
  assertEquals(rows.get(SALES)!.role, 'engineer')
  assertEquals(audits[0].old_value, { role: 'sales' })
  assertEquals(audits[0].new_value, { role: 'engineer' })
  assertEquals(audits[0].changed_by, ADMIN)
})

Deno.test('set_role to the same role writes nothing', async () => {
  const { handler, audits } = setup()
  assertEquals((await call(handler, { action: 'set_role', user_id: SALES, role: 'sales' })).status, 200)
  assertEquals(audits.length, 0)
})

Deno.test('the last admin cannot be demoted or deactivated', async () => {
  const { handler, rows, audits } = setup()
  const demote = await call(handler, { action: 'set_role', user_id: ADMIN, role: 'sales' })
  assertEquals(demote.status, 409)
  assertEquals((await demote.json()).code, 'last_admin')
  assertEquals((await call(handler, { action: 'deactivate', user_id: ADMIN })).status, 409)
  assertEquals(rows.get(ADMIN)!.role, 'admin')
  assertEquals(rows.get(ADMIN)!.deactivated_at, null)
  assertEquals(audits.length, 0)
})

Deno.test('with a second admin the first can be demoted, then the second cannot', async () => {
  const { handler, rows } = setup([profile(ADMIN2, 'admin')])
  assertEquals((await call(handler, { action: 'set_role', user_id: ADMIN, role: 'sales' })).status, 200)
  assertEquals(rows.get(ADMIN)!.role, 'sales')
  // ADMIN is no longer an admin, so ADMIN2 makes the call now.
  assertEquals((await call(handler, { action: 'set_role', user_id: ADMIN2, role: 'sales' }, ADMIN2)).status, 409)
})

Deno.test('deactivate locks the row, bans, revokes sessions, audits', async () => {
  const { handler, rows, calls, audits, state } = setup()
  const res = await call(handler, { action: 'deactivate', user_id: SALES })
  assertEquals(res.status, 200)
  assertNotEquals(rows.get(SALES)!.deactivated_at, null)
  assertEquals(calls, ['ban', 'revoke'])
  assert(state.banned.has(SALES))
  assertEquals(audits[0].new_value?.deactivated_at, rows.get(SALES)!.deactivated_at)
})

Deno.test('deactivate twice is a no-op', async () => {
  const { handler, calls } = setup()
  assertEquals((await call(handler, { action: 'deactivate', user_id: GONE })).status, 200)
  assertEquals(calls, [])
})

Deno.test('reactivate lifts the ban and clears the date', async () => {
  const { handler, rows, calls, audits } = setup()
  const res = await call(handler, { action: 'reactivate', user_id: GONE })
  assertEquals(res.status, 200)
  assertEquals(rows.get(GONE)!.deactivated_at, null)
  assertEquals(calls, ['unban'])
  assertEquals(audits.length, 1)
  assertEquals(audits[0].new_value, { deactivated_at: null })
})

Deno.test('list returns every person with their email', async () => {
  const { handler } = setup()
  const res = await call(handler, { action: 'list' })
  assertEquals(res.status, 200)
  const { users } = await res.json()
  assertEquals(users.length, 3)
  assertMatch(users[0].email, /@x\.test$/)
})

Deno.test('a failed audit write does not lose the one-time password', async () => {
  const { handler, state } = setup()
  state.failAudit = true
  const res = await call(handler, { action: 'create', name: 'A', email: 'a@b.test', role: 'sales' })
  assertEquals(res.status, 200)
  assertEquals((await res.json()).password, 'Generated-Pass-1234')
})

Deno.test('unknown action, bad JSON and wrong method', async () => {
  const { handler } = setup()
  assertEquals((await call(handler, { action: 'drop_tables' })).status, 400)
  const bad = await handler(
    new Request('http://fn/', { method: 'POST', headers: { Authorization: `Bearer tok-${ADMIN}` }, body: 'not json' }),
  )
  assertEquals(bad.status, 400)
  const get = await handler(new Request('http://fn/', { method: 'GET', headers: { Authorization: `Bearer tok-${ADMIN}` } }))
  assertEquals(get.status, 405)
})

Deno.test('CORS: allow-listed origin is echoed, others are refused', async () => {
  const { handler } = setup()
  const ok = await handler(new Request('http://fn/', { method: 'OPTIONS', headers: { Origin: ORIGIN } }))
  assertEquals(ok.status, 204)
  assertEquals(ok.headers.get('Access-Control-Allow-Origin'), ORIGIN)
  const evil = await handler(new Request('http://fn/', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }))
  assertEquals(evil.status, 403)
  assertEquals(evil.headers.get('Access-Control-Allow-Origin'), null)
  const evilPost = await handler(
    new Request('http://fn/', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', Authorization: `Bearer tok-${ADMIN}` },
      body: '{"action":"list"}',
    }),
  )
  assertEquals(evilPost.status, 403)
})

Deno.test('lib: password generator, origins, bearer, email', () => {
  const a = generatePassword()
  assertEquals(a.length, 16)
  assertMatch(a, /^[A-HJ-NP-Za-km-z2-9]+$/)
  assertNotEquals(a, generatePassword())
  assert(parseOrigins('https://crm.example, https://b.example').has('https://b.example'))
  assert(parseOrigins(undefined).has('http://localhost:5173'))
  assertEquals(bearerToken('Bearer abc'), 'abc')
  assertEquals(bearerToken('Basic abc'), null)
  assertEquals(bearerToken(null), null)
  assert(validEmail('a@b.co'))
  assert(!validEmail('a b@c.co'))
})
