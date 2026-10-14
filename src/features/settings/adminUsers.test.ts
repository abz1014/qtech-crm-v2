import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adminUsers } from '@/features/settings/adminUsers'
import { mapPgError, PlainError } from '@/lib/pgErrors'

const h = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ functions: { invoke: h.invoke } }), onApiActivity: () => () => {} }))

const httpError = (status: number, body: unknown) => ({
  message: 'Edge Function returned a non-2xx status code',
  context: new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
})

beforeEach(() => h.invoke.mockReset())

describe('adminUsers', () => {
  it('sends every action to the admin-users function with the right body', async () => {
    h.invoke.mockResolvedValue({ data: { users: [] }, error: null })
    await adminUsers.list()
    await adminUsers.create({ name: 'Hira', email: 'hira@x.test', role: 'sales' })
    await adminUsers.resetPassword('u1')
    await adminUsers.setRole('u1', 'engineer')
    await adminUsers.setJobTitle('u1', null)
    await adminUsers.deactivate('u1')
    await adminUsers.reactivate('u1')
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
    const created = await adminUsers.create({ name: 'Hira', email: 'h@x.test', role: 'sales' })
    expect(created.password).toBe('Vk7xmQ3pRt9wHn2e')
  })

  it("passes the function's own plain message and code through (last admin)", async () => {
    h.invoke.mockResolvedValue({ data: null, error: httpError(409, { error: 'The system must keep at least one active admin.', code: 'last_admin' }) })
    const err = await adminUsers.deactivate('u1').catch(e => e)
    expect(err).toBeInstanceOf(PlainError)
    expect(err.message).toBe('The system must keep at least one active admin.')
    expect(err.code).toBe('last_admin')
    expect(mapPgError(err)).toMatchObject({ message: 'The system must keep at least one active admin.', code: 'last_admin' })
  })

  it('says something plain when the body is not JSON', async () => {
    h.invoke.mockResolvedValue({ data: null, error: httpError(403, '<html>forbidden</html>') })
    expect((await adminUsers.list().catch(e => e)).message).toBe('Only an active admin can manage people.')
    h.invoke.mockResolvedValue({ data: null, error: httpError(500, 'boom') })
    expect((await adminUsers.list().catch(e => e)).message).toBe('Something went wrong. Nothing was changed. Try again.')
  })

  it('treats a request that never arrived as a network error', async () => {
    h.invoke.mockResolvedValue({ data: null, error: { message: 'Failed to send a request to the Edge Function' } })
    const err = await adminUsers.list().catch(e => e)
    expect(err).toBeInstanceOf(TypeError)
    expect(mapPgError(err).kind).toBe('network')
  })
})
