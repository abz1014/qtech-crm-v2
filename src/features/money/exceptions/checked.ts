import { useCallback, useSyncExternalStore } from 'react'
import type { ReconciliationException } from '@/lib/reconciliation'

/*
 * "Mark as checked" for Mistakes to fix (round 3: without it an item never left the month-end list). An admin looked at a
 * finding and it is fine (a deliberate overpayment, a cost known to be higher). Kept on this device, per person, keyed by the
 * finding AND its message: when the figures behind it change, the message changes and the finding comes back by itself.
 * Storage can be missing or refuse writes (private windows): every access is guarded, and a refused write still hides the item
 * for this visit. Nothing in the books changes.
 */
const PREFIX = 'qtech.checked.'
const listeners = new Set<() => void>()
const memory = new Set<string>()
let version = 0

export const checkedKey = (userId: string, e: Pick<ReconciliationException, 'key' | 'message'>): string => `${PREFIX}${userId}.${e.key}.${e.message}`

export function isChecked(key: string): boolean {
  if (memory.has(key)) return true
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

export function setChecked(key: string, checked: boolean): void {
  if (checked) memory.add(key)
  else memory.delete(key)
  try {
    if (checked) window.localStorage.setItem(key, '1')
    else window.localStorage.removeItem(key)
  } catch {
    // Storage refused: the in-memory mark above still applies until the page reloads.
  }
  version += 1
  listeners.forEach(l => l())
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  const onStorage = (ev: StorageEvent) => {
    if (ev.key === null || ev.key.startsWith(PREFIX)) {
      version += 1
      notify()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(notify)
    window.removeEventListener('storage', onStorage)
  }
}

/** The findings still open for this person (Lock a month's count and row read this too, so a checked finding leaves both). */
export const openFindings = (userId: string | null, list: readonly ReconciliationException[]): ReconciliationException[] =>
  userId ? list.filter(e => !isChecked(checkedKey(userId, e))) : [...list]

/** The findings this person has not marked as checked, re-read whenever a mark changes. */
export function useUnchecked(userId: string | null, list: readonly ReconciliationException[]): {
  open: ReconciliationException[]
  checked: ReconciliationException[]
  mark: (e: ReconciliationException, checked: boolean) => void
} {
  useSyncExternalStore(subscribe, () => version, () => version)
  const mark = useCallback((e: ReconciliationException, on: boolean) => (userId ? setChecked(checkedKey(userId, e), on) : undefined), [userId])
  if (!userId) return { open: [...list], checked: [], mark }
  const open: ReconciliationException[] = []
  const checked: ReconciliationException[] = []
  for (const e of list) (isChecked(checkedKey(userId, e)) ? checked : open).push(e)
  return { open, checked, mark }
}
