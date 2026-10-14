import { describe, expect, it } from 'vitest'
import { bootstrapAdmin, generatePassword, isLocalUrl } from './bootstrap-admin.lib.mjs'

function fakeClient({ admins = 0, profileError = null } = {}) {
  const log = { deleted: [], created: [], profiles: [], audits: [] }
  const client = {
    from(table) {
      return {
        select: () => ({ eq: () => Promise.resolve({ count: admins, error: null }) }),
        insert: (row) => {
          if (table === 'users') {
            log.profiles.push(row)
            return Promise.resolve({ error: profileError })
          }
          log.audits.push(row)
          return Promise.resolve({ error: null })
        },
      }
    },
    auth: {
      admin: {
        createUser: (args) => {
          log.created.push(args)
          return Promise.resolve({ data: { user: { id: 'new-id' } }, error: null })
        },
        deleteUser: (id) => {
          log.deleted.push(id)
          return Promise.resolve({})
        },
      },
    },
  }
  return { client, log }
}

describe('bootstrapAdmin', () => {
  it('creates the auth user, the admin row and an audit row without the password', async () => {
    const { client, log } = fakeClient()
    const r = await bootstrapAdmin({ client, name: ' Owner ', email: 'Owner@Qtech.test', password: 'Secret-Pass-9' })
    expect(r).toEqual({ id: 'new-id', email: 'owner@qtech.test', password: 'Secret-Pass-9' })
    expect(log.created[0]).toMatchObject({ email: 'owner@qtech.test', email_confirm: true })
    expect(log.profiles[0]).toEqual({ id: 'new-id', name: 'Owner', role: 'admin' })
    expect(JSON.stringify(log.audits)).not.toContain('Secret-Pass-9')
  })

  it('refuses when an admin already exists and writes nothing', async () => {
    const { client, log } = fakeClient({ admins: 1 })
    await expect(bootstrapAdmin({ client, name: 'X', email: 'x@y.test' })).rejects.toThrow(/already exists/)
    expect(log.created).toEqual([])
    expect(log.profiles).toEqual([])
  })

  it('removes the auth user when the users row fails', async () => {
    const { client, log } = fakeClient({ profileError: { message: 'nope' } })
    await expect(bootstrapAdmin({ client, name: 'X', email: 'x@y.test' })).rejects.toThrow(/auth user was removed/)
    expect(log.deleted).toEqual(['new-id'])
  })

  it('validates name and email', async () => {
    const { client } = fakeClient()
    await expect(bootstrapAdmin({ client, name: '', email: 'x@y.test' })).rejects.toThrow(/name/)
    await expect(bootstrapAdmin({ client, name: 'X', email: 'nope' })).rejects.toThrow(/email/)
  })
})

describe('helpers', () => {
  it('generates 16 unambiguous characters', () => {
    expect(generatePassword()).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/)
  })
  it('knows local URLs', () => {
    expect(isLocalUrl('http://127.0.0.1:54321')).toBe(true)
    expect(isLocalUrl('http://localhost:54321')).toBe(true)
    expect(isLocalUrl('https://abc.supabase.co')).toBe(false)
    expect(isLocalUrl('garbage')).toBe(false)
  })
})
