import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/features/settings/api'
import { setSupabaseForTests, type Db } from '@/lib/supabase'
import { mapPgError, PlainError } from '@/lib/pgErrors'

const h = vi.hoisted(() => ({ invoke: vi.fn() }))

const httpError = (status: number, body: unknown) => ({
  message: 'Edge Function returned a non-2xx status code',
  context: new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
})

/** The rejection of a call that is expected to fail. */
const fail = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected the call to fail')
    },
    (e: Error & { code?: string }) => e,
  )

beforeEach(() => {
  h.invoke.mockReset()
  setSupabaseForTests({ functions: { invoke: h.invoke } } as unknown as Db)
})

afterEach(() => setSupabaseForTests(null))

describe('settings api: phone (direct users update)', () => {
  const chain = (data: unknown) => {
    const calls: unknown[] = []
    const db = {
      from: () => ({
        update: (patch: unknown) => {
          calls.push(patch)
          return { eq: (c: string, v: string) => (calls.push([c, v]), { select: () => Promise.resolve({ data, error: null }) }) }
        },
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { id: 'u1', name: 'Ayesha', job_title: null, phone: '0300' }, error: null }) }) }),
      }),
      auth: { getSession: () => Promise.resolve({ data: { session: { user: { email: 'a@x.test' } } } }) },
    }
    setSupabaseForTests(db as unknown as Db)
    return calls
  }

  it('writes users.phone straight to the table, not through the function', async () => {
    const calls = chain([{ id: 'u1', phone: '0300' }])
    expect(await api.setPhone('u1', '0300')).toBe('0300')
    expect(calls).toEqual([{ phone: '0300' }, ['id', 'u1']])
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('says so when no row changed, instead of looking like success', async () => {
    chain([])
    expect(await fail(api.setPhone('u2', null))).toBeInstanceOf(PlainError)
  })

  it('reads the own row and takes the email from the session', async () => {
    chain([])
    expect(await api.getMyDetails('u1')).toEqual({ id: 'u1', name: 'Ayesha', job_title: null, phone: '0300', email: 'a@x.test' })
  })
})

describe('settings api: admin-users calls', () => {
  it('sends every action to the admin-users function with the right body', async () => {
    h.invoke.mockResolvedValue({ data: { users: [] }, error: null })
    await api.listTeam()
    await api.createPerson({ name: 'Hira', email: 'hira@x.test', role: 'sales' })
    await api.resetPassword('u1')
    await api.setRole('u1', 'engineer')
    await api.setJobTitle('u1', null)
    await api.deactivatePerson('u1')
    await api.reactivatePerson('u1')
    expect(h.invoke.mock.calls.map(c => [c[0], c[1].body])).toEqual([
      ['admin-users', { action: 'list' }],
      ['admin-users', { action: 'create', name: 'Hira', email: 'hira@x.test', role: 'sales' }],
      ['admin-users', { action: 'reset_password', user_id: 'u1' }],
      ['admin-users', { action: 'set_role', user_id: 'u1', role: 'engineer' }],
      ['admin-users', { action: 'set_job_title', user_id: 'u1', job_title: null }],
      ['admin-users', { action: 'deactivate', user_id: 'u1' }],
      ['admin-users', { action: 'reactivate', user_id: 'u1' }],
    ])
  })

  it('returns the generated password to the caller and nothing else keeps it', async () => {
    h.invoke.mockResolvedValue({ data: { user: { id: 'u2', name: 'Hira', email: 'h@x.test', role: 'sales', job_title: null }, password: 'Vk7xmQ3pRt9wHn2e' }, error: null })
    const created = await api.createPerson({ name: 'Hira', email: 'h@x.test', role: 'sales' })
    expect(created.password).toBe('Vk7xmQ3pRt9wHn2e')
  })

  it("passes the function's own plain message and code through (last admin)", async () => {
    h.invoke.mockResolvedValue({ data: null, error: httpError(409, { error: 'The system must keep at least one active admin.', code: 'last_admin' }) })
    const err = await fail(api.deactivatePerson('u1'))
    expect(err).toBeInstanceOf(PlainError)
    expect(err.message).toBe('The system must keep at least one active admin.')
    expect(err.code).toBe('last_admin')
    expect(mapPgError(err)).toMatchObject({ message: 'The system must keep at least one active admin.', code: 'last_admin' })
  })

  it('says something plain when the body is not JSON', async () => {
    h.invoke.mockResolvedValue({ data: null, error: httpError(403, '<html>forbidden</html>') })
    expect((await fail(api.listTeam())).message).toBe('Only an active admin can manage people.')
    h.invoke.mockResolvedValue({ data: null, error: httpError(500, 'boom') })
    expect((await fail(api.listTeam())).message).toBe('Something went wrong. Nothing was changed. Try again.')
  })

  it('treats a request that never arrived as a network error', async () => {
    h.invoke.mockResolvedValue({ data: null, error: { message: 'Failed to send a request to the Edge Function' } })
    const err = await fail(api.listTeam())
    expect(err).toBeInstanceOf(TypeError)
    expect(mapPgError(err).kind).toBe('network')
  })
})
