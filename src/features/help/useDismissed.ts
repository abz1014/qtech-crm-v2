import { useCallback, useSyncExternalStore } from 'react'

/*
 * A per-person "I have seen this" flag on this device (localStorage, key qtech.<thing>.<person id>, value "dismissed").
 * It holds nothing sensitive, so sign-out does not clear it. Storage can be missing or refuse writes (private windows,
 * blocked site data): every access is guarded, and a refused write still hides the thing for this visit.
 * Every component reading the same key updates together (the card hides when Help's "Show it again" is pressed, and back).
 */
const DISMISSED = 'dismissed'
const listeners = new Set<() => void>()
/** Keys dismissed in this visit when storage refused the write. */
const memory = new Set<string>()

function read(key: string): boolean {
  if (memory.has(key)) return true
  try {
    return window.localStorage.getItem(key) === DISMISSED
  } catch {
    return false
  }
}

export function setDismissed(key: string, dismissed: boolean): void {
  if (dismissed) memory.add(key)
  else memory.delete(key)
  try {
    if (dismissed) window.localStorage.setItem(key, DISMISSED)
    else window.localStorage.removeItem(key)
  } catch {
    // Storage refused: the in-memory flag above still applies until the page reloads.
  }
  listeners.forEach(l => l())
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith('qtech.')) notify()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(notify)
    window.removeEventListener('storage', onStorage)
  }
}

/** Whether the flag is set for `key` (null: nobody signed in, never dismissed), and a setter. */
export function useDismissed(key: string | null): [boolean, (dismissed: boolean) => void] {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => (key ? read(key) : false),
    () => false,
  )
  const set = useCallback((value: boolean) => (key ? setDismissed(key, value) : undefined), [key])
  return [dismissed, set]
}
