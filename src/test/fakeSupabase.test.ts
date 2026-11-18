import { describe, expect, it } from 'vitest'
import { filterRows, installFakeDb } from '@/test/fakeSupabase'
import { requireSupabase } from '@/lib/supabase'
import { hideArchived } from '@/lib/archive'

describe('fake client: archived defaults to false', () => {
  it('a fixture row with no archived field passes eq("archived", false) and fails eq("archived", true)', async () => {
    const rows = [{ id: 'a' }, { id: 'b', archived: true }, { id: 'c', archived: false }]
    const { calls } = installFakeDb(() => ({ data: [] }))
    const db = requireSupabase()
    await hideArchived(db.from('v_jobs').select('id'))
    await (db.from('v_jobs').select('id') as unknown as { eq(c: string, v: boolean): unknown }).eq('archived', true)
    await (db.from('v_jobs').select('id') as unknown as { neq(c: string, v: boolean): unknown }).neq('archived', true)
    expect(filterRows(rows, calls[0]).map(r => r.id)).toEqual(['a', 'c'])
    expect(filterRows(rows, calls[1]).map(r => r.id)).toEqual(['b'])
    expect(filterRows(rows, calls[2]).map(r => r.id)).toEqual(['a', 'c'])
  })
})
