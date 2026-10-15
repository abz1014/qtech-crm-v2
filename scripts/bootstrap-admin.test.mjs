import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  bootstrapAdmin,
  checkPassword,
  collectPassword,
  generatePassword,
  isLocalUrl,
  promptRefusal,
  readHidden,
  WEAK_WARNING,
} from './bootstrap-admin.lib.mjs'

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

describe('checkPassword', () => {
  it('rejects under 8 characters as too short, always', () => {
    expect(checkPassword('Ab1!xyz').tooShort).toBe(true)
  })
  it('calls 8 to 11 characters weak but not too short', () => {
    expect(checkPassword('Zebra-Quill9')).toEqual({ tooShort: false, weak: null })
    const r = checkPassword('Zebra-Q9')
    expect(r.tooShort).toBe(false)
    expect(r.weak).toMatch(/at least 12/)
  })
  it.each(['MyPassword-Is-Long', 'xx-QTech-2026-xx', 'a123456789012', 'Q-Tech Karachi 2026'])('flags the common pattern in %s', pw => {
    expect(checkPassword(pw).weak).toMatch(/common pattern/)
  })
  it('accepts a long unusual passphrase', () => {
    expect(checkPassword('blue-lantern-hollow-river')).toEqual({ tooShort: false, weak: null })
  })
})

describe('collectPassword (prompt mocked)', () => {
  const scripted = answers => {
    const said = []
    const asked = []
    const ask = label => {
      asked.push(label)
      return Promise.resolve(answers.shift())
    }
    return { ask, say: line => said.push(line), said, asked }
  }

  it('re-asks after a weak or short password, then accepts a good one after confirming', async () => {
    const t = scripted(['short', 'password-password', 'blue-lantern-hollow', 'blue-lantern-hollow'])
    expect(await collectPassword({ ask: t.ask, say: t.say })).toBe('blue-lantern-hollow')
    expect(t.said).toHaveLength(2)
    expect(t.said.join(' ')).not.toContain('blue-lantern-hollow')
  })
  it('asks again from the start when the confirmation differs', async () => {
    const t = scripted(['blue-lantern-hollow', 'blue-lantern-hollo', 'blue-lantern-hollow', 'blue-lantern-hollow'])
    await collectPassword({ ask: t.ask, say: t.say })
    expect(t.said).toEqual(['The two entries do not match. Try again.'])
  })
  it('refuses a weak password without --allow-weak', async () => {
    const t = scripted(['Zebra-Q9', 'blue-lantern-hollow', 'blue-lantern-hollow'])
    expect(await collectPassword({ ask: t.ask, say: t.say })).toBe('blue-lantern-hollow')
  })
  it('--allow-weak accepts a weak password with one warning', async () => {
    const t = scripted(['Zebra-Q9', 'Zebra-Q9'])
    expect(await collectPassword({ ask: t.ask, say: t.say, allowWeak: true })).toBe('Zebra-Q9')
    expect(t.said).toEqual([WEAK_WARNING])
  })
  it('--allow-weak still enforces the 8 character minimum', async () => {
    const t = scripted(['abc1234', 'qtech2026', 'qtech2026'])
    expect(await collectPassword({ ask: t.ask, say: t.say, allowWeak: true })).toBe('qtech2026')
    expect(t.said[0]).toMatch(/at least 8/)
  })
})

describe('refusals', () => {
  it('promptRefusal refuses a non-TTY stdin', () => {
    expect(promptRefusal({ isTTY: false })).toMatch(/not a TTY/)
    expect(promptRefusal(undefined)).toMatch(/not a TTY/)
    expect(promptRefusal({ isTTY: true, setRawMode() {} })).toBeNull()
  })

  const script = resolve(process.cwd(), 'scripts/bootstrap-admin.mjs')
  const run = args =>
    spawnSync(process.execPath, [script, ...args], {
      input: 'ignored',
      encoding: 'utf8',
      env: { ...process.env, SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-key' },
    })

  it('the CLI refuses --prompt-password when stdin is piped, before any network call', () => {
    const r = run(['--name', 'X', '--email', 'x@y.test', '--prompt-password'])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/interactive terminal/)
  })
  it('the CLI refuses --allow-weak without --prompt-password', () => {
    const r = run(['--name', 'X', '--email', 'x@y.test', '--allow-weak'])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/only works together with --prompt-password/)
  })
})

describe('readHidden (fake TTY)', () => {
  function fakeTty() {
    const input = new EventEmitter()
    input.raw = []
    input.setRawMode = v => input.raw.push(v)
    input.resume = () => {}
    input.pause = () => {}
    let out = ''
    return { input, output: { write: s => (out += s) }, out: () => out }
  }
  it('echoes only asterisks, handles backspace, returns the text', async () => {
    const t = fakeTty()
    const p = readHidden({ input: t.input, output: t.output, label: 'Pw: ' })
    t.input.emit('data', 'abc')
    t.input.emit('data', '\u007f')
    t.input.emit('data', '\u001b[A')
    t.input.emit('data', 'd')
    t.input.emit('data', '\r')
    expect(await p).toBe('abd')
    expect(t.out()).not.toContain('abd')
    expect(t.out()).toContain('Pw: ***')
    expect(t.input.raw).toEqual([true, false])
  })
  it('Ctrl+C cancels', async () => {
    const t = fakeTty()
    const p = readHidden({ input: t.input, output: t.output, label: 'Pw: ' })
    t.input.emit('data', '\u0003')
    await expect(p).rejects.toThrow(/Cancelled/)
  })
})
