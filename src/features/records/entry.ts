/*
 * Whose entry is it (owner decision 2026-10-23, enforced by 0092 guard_entered_by): sales and engineers may change what THEY
 * entered; an admin may change anything. A row with no creator (imported) is an admin's. The database refuses everyone else with
 * the HINT not_yours; this is the same rule in the page, so a field is disabled with a reason instead of failing on save.
 */
export interface Entry {
  createdBy: string | null
  ownerId: string | null
}

export interface EntryAccess {
  /** The person may change this entry. */
  can: boolean
  /** When they may not: "Entered by Ayesha: only they or an admin can change this". Null when they may. */
  note: string | null
}

export function entryAccess(
  me: { id: string; role: string } | null,
  entry: Entry,
  names: Readonly<Record<string, string>> | undefined,
): EntryAccess {
  if (!me) return { can: false, note: null }
  if (me.role === 'admin') return { can: true, note: null }
  if (entry.createdBy === me.id || entry.ownerId === me.id) return { can: true, note: null }
  const who = entry.createdBy ? names?.[entry.createdBy] : undefined
  if (entry.createdBy && !who) return { can: false, note: 'Entered by someone else: only they or an admin can change this' }
  if (!entry.createdBy) return { can: false, note: 'Entered by the old CRM import: only an admin can change this' }
  return { can: false, note: `Entered by ${who}: only they or an admin can change this` }
}
