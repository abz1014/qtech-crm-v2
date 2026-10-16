import { createHash } from 'node:crypto'

// Fixed namespace for every id this import ever makes. Never change it: the ids (and so the idempotent
// delete-and-reinsert) depend on it staying the same between dry runs and the cutover run.
export const IMPORT_NAMESPACE = '5f0b6d7e-3c1a-4d2b-9a6e-7b1c0d9e4a10'

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex')
}

/** RFC 4122 version 5 (SHA-1) UUID. */
export function uuidv5(name: string, namespace: string = IMPORT_NAMESPACE): string {
  const hash = createHash('sha1').update(uuidBytes(namespace)).update(name, 'utf8').digest()
  const b = Buffer.from(hash.subarray(0, 16))
  b[6] = (b[6]! & 0x0f) | 0x50
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** The id of an imported row of `kind`, from the old row's id (or, for companies, the normalised name). */
export function legacyId(kind: string, key: string): string {
  return uuidv5(`${kind}:${key}`)
}

/**
 * The legacy marker for tables that have no legacy_source column (sites, contacts, brands, recurring expenses...).
 * Every id this import makes is a version 5 UUID. Everything v2 creates is a random version 4 UUID
 * (gen_random_uuid() and crypto.randomUUID()), so "version nibble = 5" separates imported rows from v2 rows.
 */
export function isLegacyId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
}
