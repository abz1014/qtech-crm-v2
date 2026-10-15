/*
 * The Capture store (R22): what someone shared, pasted, dropped or picked, kept on THIS device in IndexedDB so a login
 * redirect, a reload or a dropped connection cannot lose it. Items live for 7 days (CAPTURE_TTL_MS) and are removed after
 * they are saved to a record or when they expire. Nothing here is sent anywhere.
 *
 * No React and no path aliases: the service worker imports this file too (it stores the share-target POST).
 */
export const CAPTURE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type CaptureSource = 'share' | 'paste' | 'drop' | 'pick'

export interface CaptureFile {
  name: string
  type: string
  size: number
  blob: Blob
}

export interface CaptureItem {
  id: string
  createdAt: number
  expiresAt: number
  source: CaptureSource
  /** Shared title, text and link, joined; or the pasted or typed text. */
  text: string
  files: CaptureFile[]
}

const DB_NAME = 'qtech-capture'
const STORE = 'items'

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void, factory: IDBFactory): Promise<T | undefined> {
  const db = await open(factory)
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req ? (req.result as T) : undefined)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

const defaultFactory = (): IDBFactory => (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB

export interface NewCapture {
  id?: string
  source: CaptureSource
  text?: string
  files?: CaptureFile[]
}

export async function createCapture(input: NewCapture, now = Date.now(), factory: IDBFactory = defaultFactory()): Promise<CaptureItem> {
  const item: CaptureItem = {
    id: input.id ?? crypto.randomUUID(),
    createdAt: now,
    expiresAt: now + CAPTURE_TTL_MS,
    source: input.source,
    text: input.text ?? '',
    files: input.files ?? [],
  }
  await run('readwrite', s => s.put(item), factory)
  return item
}

/** Replace the text and files of an item; the 7 days start again from the edit. */
export async function updateCapture(id: string, patch: { text?: string; files?: CaptureFile[] }, now = Date.now(), factory: IDBFactory = defaultFactory()): Promise<void> {
  const db = await open(factory)
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const get = store.get(id)
      get.onsuccess = () => {
        const cur = get.result as CaptureItem | undefined
        if (cur) store.put({ ...cur, ...patch, expiresAt: now + CAPTURE_TTL_MS })
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function getCapture(id: string, now = Date.now(), factory: IDBFactory = defaultFactory()): Promise<CaptureItem | null> {
  const item = (await run('readonly', s => s.get(id), factory)) as CaptureItem | undefined
  return item && item.expiresAt > now ? item : null
}

/** Every item that has not expired, newest first. */
export async function listCaptures(now = Date.now(), factory: IDBFactory = defaultFactory()): Promise<CaptureItem[]> {
  const all = ((await run('readonly', s => s.getAll(), factory)) as CaptureItem[] | undefined) ?? []
  return all.filter(i => i.expiresAt > now).sort((a, b) => b.createdAt - a.createdAt)
}

export async function deleteCapture(id: string, factory: IDBFactory = defaultFactory()): Promise<void> {
  await run('readwrite', s => s.delete(id), factory)
}

/** Remove every expired item. Returns how many went. */
export async function purgeExpired(now = Date.now(), factory: IDBFactory = defaultFactory()): Promise<number> {
  const all = ((await run('readonly', s => s.getAll(), factory)) as CaptureItem[] | undefined) ?? []
  const old = all.filter(i => i.expiresAt <= now)
  if (old.length === 0) return 0
  await run('readwrite', s => void old.forEach(i => s.delete(i.id)), factory)
  return old.length
}

/** Fire-and-forget safe wrappers for the UI: a private window without IndexedDB just means nothing is kept. */
export async function safely<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work()
  } catch {
    return fallback
  }
}
