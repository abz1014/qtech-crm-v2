import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { CAPTURE_TTL_MS, createCapture, deleteCapture, getCapture, listCaptures, purgeExpired, updateCapture } from '@/lib/capture/store'
import { handleShareRequest, isShareRequest, sharedText } from '@/lib/capture/shareTarget'
import { openedAgo, readRecents, recordRfqVisit } from '@/lib/capture/recents'

const DAY = 24 * 60 * 60 * 1000
let idb: IDBFactory
beforeEach(() => {
  idb = new IDBFactory()
})

describe('capture store: kept on the device for 7 days', () => {
  it('keeps an item for 7 days, then it is gone', async () => {
    const t0 = 1_000_000
    const item = await createCapture({ source: 'share', text: 'Line size is 4 inch' }, t0, idb)
    expect(item.expiresAt - item.createdAt).toBe(7 * DAY)
    expect(CAPTURE_TTL_MS).toBe(7 * DAY)
    expect((await getCapture(item.id, t0 + 6 * DAY, idb))?.text).toBe('Line size is 4 inch')
    expect(await getCapture(item.id, t0 + 7 * DAY + 1, idb)).toBeNull()
    expect(await listCaptures(t0 + 7 * DAY + 1, idb)).toEqual([])
  })

  it('purges only what has expired, and lists the newest first', async () => {
    const a = await createCapture({ source: 'paste', text: 'old' }, 0, idb)
    const b = await createCapture({ source: 'drop', text: 'mid' }, 3 * DAY, idb)
    const c = await createCapture({ source: 'pick', text: 'new' }, 6 * DAY, idb)
    expect(await purgeExpired(8 * DAY, idb)).toBe(1)
    expect((await listCaptures(8 * DAY, idb)).map(i => i.id)).toEqual([c.id, b.id])
    expect(await getCapture(a.id, 0, idb)).toBeNull()
  })

  it('an edit starts the 7 days again; delete removes it', async () => {
    const item = await createCapture({ source: 'paste', text: 'a' }, 0, idb)
    await updateCapture(item.id, { text: 'ab' }, 5 * DAY, idb)
    const kept = await getCapture(item.id, 11 * DAY, idb)
    expect(kept?.text).toBe('ab')
    await deleteCapture(item.id, idb)
    expect(await getCapture(item.id, 0, idb)).toBeNull()
  })
})

describe('share target POST', () => {
  const ORIGIN = 'https://app.test'
  const form = (fields: Record<string, string>) => {
    const f = new FormData()
    for (const [k, v] of Object.entries(fields)) f.append(k, v)
    return f
  }

  it('recognises only a same-origin POST to /capture', () => {
    expect(isShareRequest({ method: 'POST' }, new URL(ORIGIN + '/capture'), ORIGIN)).toBe(true)
    expect(isShareRequest({ method: 'GET' }, new URL(ORIGIN + '/capture'), ORIGIN)).toBe(false)
    expect(isShareRequest({ method: 'POST' }, new URL('https://x.supabase.co/capture'), ORIGIN)).toBe(false)
  })

  it('joins title, text and link once each', () => {
    expect(sharedText(form({ title: 'Flow meter', text: 'See https://a.b/c', url: 'https://a.b/c' }))).toBe('Flow meter\nSee https://a.b/c')
    expect(sharedText(form({ text: 'Same', title: 'Same' }))).toBe('Same')
  })

  it('a form post turns line breaks into CRLF; the stored text has plain LF', () => {
    expect(sharedText(form({ text: 'Line size is 4 inch\r\nFluid is hot water' }))).toBe('Line size is 4 inch\nFluid is hot water')
  })

  it('stores the payload, then redirects with a GET to the sheet', async () => {
    ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = idb
    const res = await handleShareRequest({ formData: async () => form({ text: 'Line size is 4 inch' }) } as unknown as Request, ORIGIN, 5_000)
    expect(res.status).toBe(303)
    const loc = new URL(res.headers.get('location') as string)
    expect(loc.pathname).toBe('/capture')
    const id = loc.searchParams.get('share') as string
    expect((await getCapture(id, 5_000, idb))?.text).toBe('Line size is 4 inch')
  })

  it('an unreadable share still opens Capture, empty', async () => {
    const res = await handleShareRequest({ formData: async () => Promise.reject(new Error('bad')) } as unknown as Request, ORIGIN)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`${ORIGIN}/capture`)
  })
})

describe('recently opened RFQs', () => {
  it('lists the newest visit first, once per RFQ, at most 12', () => {
    window.localStorage.clear()
    for (let i = 0; i < 15; i++) recordRfqVisit(`r${i}`, i)
    recordRfqVisit('r3', 100)
    const list = readRecents()
    expect(list).toHaveLength(12)
    expect(list[0]).toEqual({ id: 'r3', at: 100 })
    expect(list.filter(r => r.id === 'r3')).toHaveLength(1)
  })

  it('says how long ago in plain words', () => {
    const now = 10 * DAY
    expect(openedAgo(now - 30_000, now)).toBe('just now')
    expect(openedAgo(now - 2 * 3_600_000, now)).toBe('2 hours ago')
    expect(openedAgo(now - DAY, now)).toBe('yesterday')
  })
})
