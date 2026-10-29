import { afterEach, describe, expect, it } from 'vitest'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { appendNotesSafely, CANNOT_UNDO_NOTE, NOTES_CHANGED, undoAppendedNote } from '@/features/capture/api'

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

const add = (current: string | null) => (current ? `${current}\nnew line` : 'new line')

describe('appendNotesSafely: two people saving a note at once', () => {
  it('writes only if the row is as it was read (conditional on updated_at) and returns what was there before', async () => {
    const db = installFakeDb((c: FakeCall) => (c.verb === 'select' ? { data: { notes: 'first', updated_at: '2026-10-28T10:00:00.123456+00:00' } } : { data: [{ id: 'o-1' }] }))
    const out = await appendNotesSafely('orders', 'o-1', add)
    expect(out).toMatchObject({ before: 'first', after: 'first\nnew line' })
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

describe('undoAppendedNote: taking back our own note', () => {
  const NL = String.fromCharCode(10)
  const afterText = 'first' + NL + NL + 'ours'

  it('puts the previous notes back when nothing changed since (the write is conditional on the updated_at just read)', async () => {
    const db = installFakeDb((c: FakeCall) => (c.verb === 'select' ? { data: { notes: afterText, updated_at: 'T2' } } : { data: [{ id: 'o-1', updated_at: 'T3' }] }))
    await undoAppendedNote('orders', 'o-1', { before: 'first', after: afterText })
    const write = db.calls.find(c => c.verb === 'update') as FakeCall
    expect(opArgs(write, 'update')?.[0]).toEqual({ notes: 'first' })
    expect(write.ops).toContainEqual(['eq', ['updated_at', 'T2']])
  })

  it('restores no notes at all when there were none before', async () => {
    const db = installFakeDb((c: FakeCall) => (c.verb === 'select' ? { data: { notes: 'ours', updated_at: 'T2' } } : { data: [{ id: 'o-1' }] }))
    await undoAppendedNote('orders', 'o-1', { before: null, after: 'ours' })
    expect(opArgs(db.calls.find(c => c.verb === 'update') as FakeCall, 'update')?.[0]).toEqual({ notes: null })
  })

  it('when someone added a line after ours, only our own line is removed and theirs stays', async () => {
    const db = installFakeDb((c: FakeCall) => (c.verb === 'select' ? { data: { notes: afterText + NL + 'theirs', updated_at: 'T9' } } : { data: [{ id: 'o-1' }] }))
    await undoAppendedNote('rfqs', 'r-1', { before: 'first', after: afterText })
    expect(opArgs(db.calls.find(c => c.verb === 'update') as FakeCall, 'update')?.[0]).toEqual({ notes: 'first' + NL + 'theirs' })
  })

  it('says it cannot undo when our line is no longer in the notes, and writes nothing', async () => {
    const db = installFakeDb((c: FakeCall) => (c.verb === 'select' ? { data: { notes: 'rewritten', updated_at: 'T9' } } : { data: [{ id: 'o-1' }] }))
    await expect(undoAppendedNote('orders', 'o-1', { before: 'first', after: afterText })).rejects.toThrow(CANNOT_UNDO_NOTE)
    expect(db.calls.filter(c => c.verb === 'update')).toHaveLength(0)
  })

  it('retries once when the notes change between the read and the write', async () => {
    let reads = 0
    const db = installFakeDb((c: FakeCall) => {
      if (c.verb === 'select') {
        reads += 1
        return { data: reads === 1 ? { notes: afterText, updated_at: 'T1' } : { notes: afterText + NL + 'theirs', updated_at: 'T2' } }
      }
      return { data: c.ops.some(([n, a]) => n === 'eq' && a[0] === 'updated_at' && a[1] === 'T2') ? [{ id: 'o-1' }] : [] }
    })
    await undoAppendedNote('orders', 'o-1', { before: 'first', after: afterText })
    expect(db.calls.filter(c => c.verb === 'update')).toHaveLength(2)
  })
})
