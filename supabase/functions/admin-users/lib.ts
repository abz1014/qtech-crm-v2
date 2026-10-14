/** Letters and digits without the look-alikes (0 O o 1 l I). 56 symbols. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

/** A random password: 16 characters, about 93 bits, uniform (rejection sampling, no modulo bias). */
export function generatePassword(length = 16): string {
  const limit = 256 - (256 % ALPHABET.length)
  let out = ''
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2))
    for (const b of bytes) {
      if (b < limit && out.length < length) out += ALPHABET[b % ALPHABET.length]
    }
  }
  return out
}

/** Local dev origins are always allowed; production origins come from the ALLOWED_ORIGINS secret. */
export const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173']

/** Origins from the ALLOWED_ORIGINS secret (comma separated), plus the dev origins. */
export function parseOrigins(raw: string | undefined | null): Set<string> {
  const configured = (raw ?? '').split(',').map((o) => o.trim()).filter(Boolean)
  return new Set([...DEV_ORIGINS, ...configured])
}

export function bearerToken(header: string | null): string | null {
  if (!header) return null
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return m ? m[1] : null
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function validEmail(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 254 && EMAIL.test(s)
}
