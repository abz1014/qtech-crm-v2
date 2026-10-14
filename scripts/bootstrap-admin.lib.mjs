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
