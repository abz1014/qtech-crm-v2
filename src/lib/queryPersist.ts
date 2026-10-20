import { dehydrate, hydrate, type DehydratedState, type Query, type QueryClient } from '@tanstack/react-query'

/*
 * The query cache survives a cold open (performance audit improvement 3). A phone that opens the app again shows the
 * last-known lists at once and refreshes them in the background, and shows them offline instead of empty skeletons.
 *
 *  - Kept in IndexedDB on this device only ("qtech-cache"), as one record: the person it belongs to, the build that wrote
 *    it and the time. It is used only when all three match: the same person as the Supabase session kept on this device,
 *    the same build (a deploy may change what a query returns) and younger than PERSIST_MAX_AGE_MS. Otherwise it is deleted.
 *  - Only successful reads the person's own session already made are kept: nothing beyond what their role can see.
 *    Left out: the session lookup itself (AuthProvider keeps its own small record), signed file links (short-lived
 *    bearer URLs), search results and gcTime-0 reads (next numbers, last terms: always read fresh).
 *  - Written at most every THROTTLE_MS while the cache changes, and at once when the app goes to the background
 *    (switching to WhatsApp is when Android may discard it).
 *  - Forgotten on sign-out and when a different person signs in (AuthProvider), like the Capture drafts (security review L-5).
 */
declare const __APP_BUILD__: string | undefined

export const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000
const THROTTLE_MS = 1500
const FORMAT = 1
const DB_NAME = 'qtech-cache'
const STORE = 'kv'
const RECORD = 'queries'

interface Saved {
  format: number
  build: string
  userId: string
  savedAt: number
  state: DehydratedState
}

export const BUILD_ID: string = typeof __APP_BUILD__ === 'string' && __APP_BUILD__ ? __APP_BUILD__ : 'dev'

function factory(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB
  } catch {
    return null
  }
}

function openDb(f: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = f.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  const f = factory()
  if (!f) return undefined
  const db = await openDb(f)
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const req = fn(t.objectStore(STORE))
      t.oncomplete = () => resolve(req ? (req.result as T) : undefined)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
  } finally {
    db.close()
  }
}

const readSaved = () => tx<Saved>('readonly', s => s.get(RECORD))
const writeSaved = (value: Saved) => tx<void>('readwrite', s => void s.put(value, RECORD))
const deleteSaved = () => tx<void>('readwrite', s => void s.delete(RECORD))

/** Keys (or key parts) that are never written to the device. */
const NEVER = new Set(['session', 'file-urls', 'search', 'capture-search', 'past'])

export function shouldPersist(query: Query): boolean {
  if (query.state.status !== 'success' || query.state.data === undefined) return false
  if (query.gcTime === 0) return false
  return !query.queryKey.some(part => typeof part === 'string' && NEVER.has(part))
}

let client: QueryClient | null = null
/** The person whose reads the cache holds; null while nobody is signed in (nothing is written then). */
let owner: string | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let stopListening: (() => void) | null = null

function cancel(): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
}

function schedule(): void {
  if (!owner || timer !== undefined) return
  timer = setTimeout(() => void flushSavedQueries(), THROTTLE_MS)
}

function cloneable(data: unknown): boolean {
  try {
    structuredClone(data)
    return true
  } catch {
    return false
  }
}

/** Write the cache now (also called when the app goes to the background). */
export async function flushSavedQueries(): Promise<void> {
  cancel()
  if (!client || !owner) return
  const who = owner
  const state = dehydrate(client, { shouldDehydrateQuery: shouldPersist, shouldDehydrateMutation: () => false })
  const record = (s: DehydratedState): Saved => ({ format: FORMAT, build: BUILD_ID, userId: who, savedAt: Date.now(), state: s })
  try {
    await writeSaved(record(state))
  } catch {
    // A read holding something IndexedDB cannot store (a function, a class instance): leave that one out.
    try {
      await writeSaved(record({ ...state, queries: state.queries.filter(q => cloneable(q.state.data)) }))
    } catch {
      /* storage full or blocked: the app simply opens without saved data next time */
    }
  }
  // Signed out (or someone else signed in) while this was being written: it must not stay on the device.
  if (owner !== who) await deleteSaved().catch(() => {})
}

/**
 * Restore what `userId` saved (if it is theirs, from this build and fresh), then keep the cache saved. Call once with the
 * app's client and the user id of the Supabase session kept on this device. Resolves when the restore is done.
 */
export async function startQueryPersistence(qc: QueryClient, userId: string | null): Promise<void> {
  if (client === qc) return
  stopListening?.()
  client = qc
  const unsubscribe = qc.getQueryCache().subscribe(event => {
    if (event.type === 'added' || event.type === 'removed' || event.type === 'updated') schedule()
  })
  const onHide = () => {
    if (document.visibilityState === 'hidden') void flushSavedQueries()
  }
  const onPageHide = () => void flushSavedQueries()
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', onPageHide)
  stopListening = () => {
    unsubscribe()
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('pagehide', onPageHide)
  }
  try {
    const saved = await readSaved()
    if (!saved) return
    const usable =
      saved.format === FORMAT &&
      saved.build === BUILD_ID &&
      Boolean(userId) &&
      saved.userId === userId &&
      Date.now() - saved.savedAt < PERSIST_MAX_AGE_MS &&
      (owner === null || owner === saved.userId)
    // Restored data is shown at once but always counts as stale, whatever a read's staleTime: the first screen that
    // mounts it reads it again (an edit made on another device or by a colleague must not wait out a 5-minute staleTime).
    // Marked invalidated: the next mount refetches it, and a screen already showing it refetches now.
    if (usable) {
      hydrate(qc, saved.state)
      for (const q of saved.state.queries) {
        const query = qc.getQueryCache().find({ queryKey: q.queryKey, exact: true })
        if (query && query.state.dataUpdatedAt <= q.state.dataUpdatedAt) {
          query.invalidate()
          if (query.getObserversCount() > 0 && query.state.fetchStatus === 'idle') void query.fetch().catch(() => {})
        }
      }
    }
    else await deleteSaved()
  } catch {
    /* IndexedDB unavailable (private mode, blocked): start empty */
  }
}

/**
 * Whose reads the cache holds. A different person than before means the cache is someone else's: it is emptied, here
 * and on the device. null (signed out) stops writing; forgetSavedQueries() deletes.
 */
export function setCacheOwner(userId: string | null): void {
  if (userId === owner) return
  if (userId && owner && userId !== owner) {
    cancel()
    client?.clear()
    void deleteSaved().catch(() => {})
  }
  owner = userId
  if (!userId) cancel()
  else schedule()
}

/** Sign-out: delete what this device saved and stop writing. */
export async function forgetSavedQueries(): Promise<void> {
  cancel()
  owner = null
  try {
    await deleteSaved()
  } catch {
    /* nothing could be kept either */
  }
}

/** Tests only. */
export function resetQueryPersistenceForTests(): void {
  cancel()
  stopListening?.()
  stopListening = null
  client = null
  owner = null
}
