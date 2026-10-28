import { afterEach, describe, expect, it } from 'vitest'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { appendNotesSafely, NOTES_CHANGED } from '@/features/capture/api'

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

const add = (current: string | null) => (current ? `${current}\nnew line` : 'new line')

describe('appendNotesSafely: two people saving a note at once', () => {
  it('writes only if the row is as it was read (conditional on updated_at) and returns what was there before', async () => {
    const db = installFakeDb((c: FakeCall) => (c.verb === 'select' ? { data: { notes: 'first', updated_at: '2026-10-28T10:00:00.123456+00:00' } } : { data: [{ id: 'o-1' }] }))
    const out = await appendNotesSafely('orders', 'o-1', add)
    expect(out).toEqual({ before: 'first', after: 'first\nnew line' })
    const write = db.calls.find(c => c.verb === 'update') as FakeCall
    expect(opArgs(write, 'update')?.[0]).toEqual({ notes: 'first\nnew line' })
    expect(write.ops.filter(([n]) => n === 'eq')).toEqual([
      ['eq', ['id', 'o-1']],
      ['eq', ['updated_at', '2026-10-28T10:00:00.123456+00:00']],
    ])
  })

  it('when someone else saved first the write matches nothing: the notes are read again and the line is added to the fresh text', async () => {
    let reads = 0
    const db = installFakeDb((c: FakeCall) => {
      if (c.verb === 'select') {
        reads += 1
        return { data: reads === 1 ? { notes: 'first', updated_at: 'T1' } : { notes: 'first\nsomeone else', updated_at: 'T2' } }
      }
      return { data: opArgs(c, 'eq') && c.ops.some(([n, a]) => n === 'eq' && a[0] === 'updated_at' && a[1] === 'T2') ? [{ id: 'r-1' }] : [] }
    })
    const out = await appendNotesSafely('rfqs', 'r-1', add)
    expect(out.after).toBe('first\nsomeone else\nnew line')
    expect(db.calls.filter(c => c.verb === 'update')).toHaveLength(2)
  })

  it('gives up with a plain message after one retry, writing nothing more', async () => {
    const db = installFakeDb((c: FakeCall) => (c.verb === 'select' ? { data: { notes: null, updated_at: 'T' } } : { data: [] }))
    await expect(appendNotesSafely('orders', 'o-1', add)).rejects.toThrow(NOTES_CHANGED)
    expect(db.calls.filter(c => c.verb === 'update')).toHaveLength(2)
  })

  it('a database error stops at once', async () => {
    const db = installFakeDb((c: FakeCall) => (c.verb === 'select' ? { data: { notes: null, updated_at: 'T' } } : { error: { message: 'boom' } }))
    await expect(appendNotesSafely('orders', 'o-1', add)).rejects.toMatchObject({ message: 'boom' })
    expect(db.calls.filter(c => c.verb === 'update')).toHaveLength(1)
  })
})
