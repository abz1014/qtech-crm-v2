import { useSession } from '@/app/session'
import { useUserNames } from '@/features/rfqs/hooks'
import { entryAccess, type Entry, type EntryAccess } from '@/features/records/entry'

/** entryAccess() for the signed-in person. Names are read only when the answer is "no" (they are needed for the reason). */
export function useEntryAccess(entry: Entry): EntryAccess {
  const s = useSession()
  const me = s.status === 'signed-in' ? s.user : null
  const mine = me !== null && (me.role === 'admin' || entry.createdBy === me.id || entry.ownerId === me.id)
  const names = useUserNames(!mine)
  return entryAccess(me, entry, names.data)
}
