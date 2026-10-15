// First-admin bootstrap logic (A02). Kept apart from the CLI so it can be unit tested with a fake client.
import { randomInt } from 'node:crypto'

// Letters and digits without the look-alikes (0 O o 1 l I).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

export function generatePassword(length = 16) {
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

export function isLocalUrl(url) {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
  } catch {
    return false
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Creates the first admin. `client` is a supabase-js client built with the service-role key.
 * Throws (and writes nothing) if any admin already exists. Returns { id, email, password }.
 */
export async function bootstrapAdmin({ client, name, email, password = generatePassword() }) {
  const cleanName = String(name ?? '').trim()
  const cleanEmail = String(email ?? '').trim().toLowerCase()
  if (!cleanName) throw new Error('A name is required (--name).')
  if (!EMAIL.test(cleanEmail)) throw new Error('A valid email is required (--email).')

  const existing = await client.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin')
  if (existing.error) throw new Error(`Could not check for an existing admin: ${existing.error.message}`)
  if ((existing.count ?? 0) > 0) {
    throw new Error('An admin already exists. Refusing to create another. Use the Team screen to add people.')
  }

  const created = await client.auth.admin.createUser({ email: cleanEmail, password, email_confirm: true })
  if (created.error || !created.data?.user) {
    throw new Error(`Could not create the auth user: ${created.error?.message ?? 'unknown error'}`)
  }
  const id = created.data.user.id

  const profile = await client.from('users').insert({ id, name: cleanName, role: 'admin' })
  if (profile.error) {
    await client.auth.admin.deleteUser(id)
    throw new Error(`Could not create the users row (the auth user was removed): ${profile.error.message}`)
  }

  // Audit, never the password.
  const audit = await client.from('audit_log').insert({
    table_name: 'users',
    record_id: id,
    action: 'insert',
    changed_by: id,
    old_value: null,
    new_value: { name: cleanName, email: cleanEmail, role: 'admin', source: 'bootstrap-admin' },
  })
  if (audit.error) console.error(`Warning: the audit row was not written: ${audit.error.message}`)

  return { id, email: cleanEmail, password }
}

// ---------------------------------------------------------------------------------------------
// Typing your own password (--prompt-password). Nothing here prints, logs or stores the password.
// ---------------------------------------------------------------------------------------------

export const MIN_LENGTH = 12
/** Even with --allow-weak. */
export const HARD_MIN_LENGTH = 8
export const WEAK_WARNING = 'Weak password accepted on request; change it after first sign-in.'

// Short on purpose: common patterns, the company name, and the company name with a year.
const WEAK_PATTERNS = ['password', 'passw0rd', 'qtech', 'q-tech', 'q tech', '123456', 'qwerty', 'letmein', 'welcome', 'admin123']

/**
 * Judges a password without ever returning it. `tooShort` (under 8) is never accepted.
 * `weak` is a plain sentence when it is under 12 characters or matches a common pattern, else null.
 */
export function checkPassword(password) {
  const pw = String(password ?? '')
  if (pw.length < HARD_MIN_LENGTH) {
    return { tooShort: true, weak: `Too short: use at least ${HARD_MIN_LENGTH} characters (${MIN_LENGTH} or more is recommended).` }
  }
  const lower = pw.toLowerCase()
  if (WEAK_PATTERNS.some(p => lower.includes(p))) {
    return { tooShort: false, weak: 'Too easy to guess: it contains a common pattern such as "password", "123456" or the company name.' }
  }
  if (pw.length < MIN_LENGTH) {
    return { tooShort: false, weak: `Too short: use at least ${MIN_LENGTH} characters.` }
  }
  return { tooShort: false, weak: null }
}

/**
 * Asks twice until the password passes. `ask(label)` returns the typed text (hidden by the caller);
 * `say(line)` shows a plain message. With allowWeak, a weak (not too-short) password is accepted with one warning.
 */
export async function collectPassword({ ask, say, allowWeak = false }) {
  for (;;) {
    const first = await ask('New password: ')
    const verdict = checkPassword(first)
    if (verdict.tooShort || (verdict.weak && !allowWeak)) {
      say(verdict.weak)
      continue
    }
    const second = await ask('Type it again to confirm: ')
    if (second !== first) {
      say('The two entries do not match. Try again.')
      continue
    }
    if (verdict.weak) say(WEAK_WARNING)
    return first
  }
}

/** Why the flag cannot run here, or null. Piped input is out of scope: refuse. */
export function promptRefusal(stdin) {
  if (!stdin || !stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return '--prompt-password needs an interactive terminal (stdin is not a TTY). Run it in PowerShell or Windows Terminal yourself; piped input is not supported.'
  }
  return null
}

/**
 * Reads one line from a TTY with echo off, printing `*` per character. Raw mode on stdin, Node built-ins only.
 * Enter finishes, Backspace deletes, Ctrl+C aborts, escape sequences (arrows, Delete) are ignored.
 */
export function readHidden({ input, output, label }) {
  return new Promise((resolve, reject) => {
    let buf = ''
    output.write(label)
    input.setRawMode(true)
    input.resume()
    const finish = fn => {
      input.off('data', onData)
      input.setRawMode(false)
      input.pause()
      output.write('\n')
      fn()
    }
    function onData(chunk) {
      const text = String(chunk)
      // An escape sequence (arrow keys etc.) arrives as one chunk starting with ESC.
      if (text.startsWith('\u001b')) return
      for (const ch of text) {
        if (ch === '\r' || ch === '\n') return finish(() => resolve(buf))
        if (ch === '\u0003') return finish(() => reject(new Error('Cancelled.')))
        if (ch === '\u007f' || ch === '\b') {
          if (buf.length > 0) {
            buf = buf.slice(0, -1)
            output.write('\b \b')
          }
          continue
        }
        if (ch < ' ') continue
        buf += ch
        output.write('*')
      }
    }
    input.on('data', onData)
  })
}
