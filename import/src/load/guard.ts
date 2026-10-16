// The one place that decides whether the loader may talk to a database. Everything here is pure so it is unit tested.
//
// Rules:
//   1. The OLD project is never a write target. Any URL or key that names it is refused, with or without flags.
//   2. A local stack (localhost, 127.0.0.1, ::1, *.localhost) needs nothing.
//   3. Anything else needs --i-know-this-is-live AND the project ref in the allowlist (--allow-project-ref, repeatable).
//   4. The key must be a service-role key and, for a hosted project, must belong to the project in the URL.

/** The legacy Supabase project. It is the SOURCE of the data and is never written to. */
export const LEGACY_PROJECT_REF = 'vptyhluvgnjpvkcbhxsf'

export interface GuardFlags {
  iKnowThisIsLive: boolean
  allowProjectRefs: string[]
}

export interface GuardResult {
  kind: 'local' | 'live'
  /** The project ref for a hosted project, null for a local stack. */
  ref: string | null
  host: string
}

export class GuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GuardError'
  }
}

const HOSTED = /^([a-z0-9]{20})\.supabase\.(co|in|net)$/

export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost')
}

function jwtClaims(key: string): Record<string, unknown> | null {
  const parts = key.split('.')
  if (parts.length !== 3) return null
  try {
    const json = Buffer.from(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const v: unknown = JSON.parse(json)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function assertTargetAllowed(url: string, serviceKey: string, flags: GuardFlags): GuardResult {
  if (!url) throw new GuardError('No target URL. Set IMPORT_TARGET_URL.')
  if (!serviceKey) throw new GuardError('No service-role key. Set IMPORT_SERVICE_ROLE_KEY.')

  // Rule 1, checked first and on the raw text so no spelling of the URL gets past it.
  const claims = jwtClaims(serviceKey)
  if (url.toLowerCase().includes(LEGACY_PROJECT_REF) || serviceKey.toLowerCase().includes(LEGACY_PROJECT_REF) || claims?.['ref'] === LEGACY_PROJECT_REF) {
    throw new GuardError('REFUSED: this is the legacy project. The import never writes to it (it is the source, and stays untouched).')
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new GuardError(`REFUSED: "${url}" is not a valid URL.`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new GuardError('REFUSED: the target URL must be http or https.')
  if (parsed.username || parsed.password) throw new GuardError('REFUSED: the target URL must not contain credentials.')

  const host = parsed.hostname

  if (isLocalHost(host)) {
    if (claims && claims['role'] !== undefined && claims['role'] !== 'service_role') {
      throw new GuardError(`REFUSED: the key's role is "${String(claims['role'])}", not service_role.`)
    }
    return { kind: 'local', ref: null, host }
  }

  // Hosted: rule 3.
  const m = HOSTED.exec(host.toLowerCase())
  if (!m) throw new GuardError(`REFUSED: "${host}" is neither a local stack nor a hosted Supabase project.`)
  const ref = m[1]!
  if (!flags.iKnowThisIsLive) {
    throw new GuardError(`REFUSED: ${ref} is a live project. Pass --i-know-this-is-live and --allow-project-ref ${ref} to write to it.`)
  }
  const allowed = flags.allowProjectRefs.map(r => r.trim().toLowerCase()).filter(Boolean)
  if (!allowed.includes(ref)) {
    throw new GuardError(`REFUSED: project ref ${ref} is not in the allowlist (--allow-project-ref).`)
  }

  // Rule 4.
  if (claims) {
    if (claims['role'] !== 'service_role') throw new GuardError(`REFUSED: the key's role is "${String(claims['role'])}", not service_role.`)
    if (claims['ref'] !== undefined && claims['ref'] !== ref) throw new GuardError('REFUSED: the key belongs to a different project than the URL.')
  } else if (!serviceKey.startsWith('sb_secret_')) {
    throw new GuardError('REFUSED: the key is neither a service-role JWT nor an sb_secret_ key.')
  }
  return { kind: 'live', ref, host }
}
