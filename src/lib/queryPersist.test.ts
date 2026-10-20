import { IDBFactory } from 'fake-indexeddb'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { qk } from '@/features/queryKeys'
import {
  flushSavedQueries,
  forgetSavedQueries,
  PERSIST_MAX_AGE_MS,
  resetQueryPersistenceForTests,
  setCacheOwner,
  startQueryPersistence,
} from '@/lib/queryPersist'

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

/** A fresh client, as on the next cold open, restored for `userId`. */
async function reopen(userId: string | null): Promise<QueryClient> {
  resetQueryPersistenceForTests()
  const qc = client()
  await startQueryPersistence(qc, userId)
  return qc
}

async function rawRecord(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('qtech-cache', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('kv')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const get = open.result.transaction('kv').objectStore('kv').get('queries')
      get.onsuccess = () => {
        open.result.close()
        resolve(get.result)
      }
    }
  })
}

beforeEach(() => {
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
})
afterEach(() => resetQueryPersistenceForTests())

describe('the saved query cache (performance audit 3)', () => {
  it('a cold open shows the last-known data for the same person', async () => {
    const qc = await reopen('u1')
    setCacheOwner('u1')
    qc.setQueryData(qk.rfqs.board(), [{ id: 'r1', number: 'RFQ-0001' }])
    await flushSavedQueries()

    const next = await reopen('u1')
    expect(next.getQueryData(qk.rfqs.board())).toEqual([{ id: 'r1', number: 'RFQ-0001' }])
    // Restored data is shown at once but always stale (even under a 5-minute staleTime): a screen that mounts it reads it again.
    expect(next.getQueryState(qk.rfqs.board())?.isInvalidated).toBe(true)
  })

  it('is never shown to someone else, and is deleted then', async () => {
    const qc = await reopen('u1')
    setCacheOwner('u1')
    qc.setQueryData(qk.today.board(), { items: 3 })
    await flushSavedQueries()

    const other = await reopen('u2')
    expect(other.getQueryData(qk.today.board())).toBeUndefined()
    expect(await rawRecord()).toBeUndefined()
  })

  it('nothing is restored without a kept session', async () => {
    const qc = await reopen('u1')
    setCacheOwner('u1')
    qc.setQueryData(qk.today.board(), { items: 3 })
    await flushSavedQueries()
    const next = await reopen(null)
    expect(next.getQueryData(qk.today.board())).toBeUndefined()
  })

  it('leaves out signed file links, searches, gcTime-0 reads and the session lookup', async () => {
    const qc = await reopen('u1')
    setCacheOwner('u1')
    qc.setQueryData(qk.rfqs.fileUrls('r1', 'sig'), { 'a.jpg': 'https://signed.example/a?token=secret' })
    qc.setQueryData(qk.companies.search('punjab'), [{ id: 'c1' }])
    qc.setQueryData(['session', 'user', 'u1'], { user: { id: 'u1' } })
    qc.setQueryData(qk.orders.nextNumber(), 'ORD-0040')
    qc.getQueryCache().find({ queryKey: qk.orders.nextNumber() })!.gcTime = 0
    qc.setQueryData(qk.companies.list(), [{ id: 'c1' }])
    await flushSavedQueries()

    const saved = (await rawRecord()) as { state: { queries: { queryKey: unknown[] }[] } }
    expect(saved.state.queries.map(q => q.queryKey)).toEqual([qk.companies.list()])
  })

  it('sign-out deletes it, and nothing more is written until someone signs in', async () => {
    const qc = await reopen('u1')
    setCacheOwner('u1')
    qc.setQueryData(qk.today.board(), { items: 3 })
    await flushSavedQueries()
    await forgetSavedQueries()
    expect(await rawRecord()).toBeUndefined()
    qc.setQueryData(qk.today.board(), { items: 4 })
    await flushSavedQueries()
    expect(await rawRecord()).toBeUndefined()
  })

  it('a different person signing in empties the cache in memory and on the device', async () => {
    const qc = await reopen('u1')
    setCacheOwner('u1')
    qc.setQueryData(qk.today.board(), { items: 3 })
    await flushSavedQueries()
    setCacheOwner('u2')
    expect(qc.getQueryData(qk.today.board())).toBeUndefined()
    await new Promise(r => setTimeout(r, 20))
    expect(await rawRecord()).toBeUndefined()
  })

  it('a record older than the limit, or from another build, is not used', async () => {
    const qc = await reopen('u1')
    setCacheOwner('u1')
    qc.setQueryData(qk.today.board(), { items: 3 })
    const realNow = Date.now
    Date.now = () => realNow() - PERSIST_MAX_AGE_MS - 1000
    try {
      await flushSavedQueries()
    } finally {
      Date.now = realNow
    }
    const next = await reopen('u1')
    expect(next.getQueryData(qk.today.board())).toBeUndefined()
  })
})
