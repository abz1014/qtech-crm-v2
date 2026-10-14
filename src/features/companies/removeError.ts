import { InUseError } from '@/features/companies/api'
import { mapPgError } from '@/lib/pgErrors'

/**
 * The sentence shown when a remove fails. A site or contact that RFQs, orders or quotations still use
 * says how many ("This site is used on 3 RFQs; it can't be removed."); any other failure goes through
 * mapPgError, so a database 23503 gets its plain sentence too. Nothing is ever half removed.
 */
export function removeErrorMessage(err: unknown, entity: string): string {
  if (err instanceof InUseError) return err.message
  // On a remove, a foreign-key refusal can only mean something still uses it.
  if ((err as { code?: string } | null)?.code === '23503') return `This ${entity} is still used by other records, so it can't be removed.`
  return mapPgError(err, { entity }).message
}
