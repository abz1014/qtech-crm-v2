import { useSyncExternalStore } from 'react'
import { PlainError } from '@/lib/errors/plainError'

/*
 * Minimum app version (owner decision 2026-10-22). The server side is a static file: every deploy publishes /version.json
 * ({ version, minSupported, build }, from app-version.json at the repository root; vite.config.ts) with no-cache, outside the
 * service worker's precache. This running build knows its own `version` (__APP_VERSION__). When the published minSupported is
 * above it, the deploy changed something an older app must not write to, so:
 *   - READING goes on as before (nothing is hidden or blanked),
 *   - every SAVE is refused before it is sent (the MutationCache's onMutate, src/lib/queryClient.ts), with a plain sentence;
 *     the form keeps what was typed, as with an offline save,
 *   - the shell shows "Update needed — tap Reload" (src/app/shell/UpdateNeededBanner.tsx), which moves this window onto the new
 *     service worker (src/lib/pwa/updates.ts reloadOntoNewVersion).
 * Checked once at start, when the app comes back to the front (at most every 5 minutes), when the network returns, and every
 * 30 minutes. A failed check changes nothing. Once an update is needed it stays needed until the page reloads.
 */
declare const __APP_VERSION__: number | undefined

export const APP_VERSION: number = typeof __APP_VERSION__ === 'number' ? __APP_VERSION__ : 0

export const UPDATE_NEEDED_MESSAGE =
  'Update needed: this copy of the app is out of date, so saving is paused. Tap Reload in the bar at the top. Nothing was saved.'

let needed = false
const listeners = new Set<() => void>()

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

function markNeeded(): void {
  if (needed) return
  needed = true
  listeners.forEach(l => l())
}

export function isUpdateNeeded(): boolean {
  return needed
}

export function useUpdateNeeded(): boolean {
  return useSyncExternalStore(subscribe, () => needed, () => false)
}

/** Whether the published file asks for a newer app than `running`. Anything malformed asks for nothing. */
export function needsUpdate(published: unknown, running: number = APP_VERSION): boolean {
  if (typeof published !== 'object' || published === null) return false
  const min = (published as { minSupported?: unknown }).minSupported
  return typeof min === 'number' && Number.isFinite(min) && min > running
}

/** Read /version.json now. Resolves to whether an update is needed; never throws. */
export async function checkMinVersion(fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetcher('/version.json', { cache: 'no-store', headers: { accept: 'application/json' } })
    if (res.ok && needsUpdate(await res.json())) markNeeded()
  } catch {
    // offline, or a host without the file: nothing to say
  }
  return needed
}

/** The MutationCache's guard: a save started by an out-of-date app is refused before anything is sent. */
export function refuseOutdatedSave(): void {
  if (needed) throw new PlainError(UPDATE_NEEDED_MESSAGE, 'update_needed')
}

const RETURN_EVERY_MS = 5 * 60_000
const POLL_EVERY_MS = 30 * 60_000
let started = false

export function startMinVersionChecks(): void {
  if (started || typeof window === 'undefined' || typeof fetch === 'undefined') return
  started = true
  let last = Date.now()
  const check = () => {
    last = Date.now()
    void checkMinVersion()
  }
  check()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - last >= RETURN_EVERY_MS) check()
  })
  window.addEventListener('online', check)
  window.setInterval(() => {
    if (document.visibilityState === 'visible') check()
  }, POLL_EVERY_MS)
}

/** Tests only. */
export function resetMinVersionForTests(next = false): void {
  needed = next
  listeners.forEach(l => l())
}
