import { afterEach, describe, expect, it } from 'vitest'
import { STALE_EDIT, updateCompany } from '@/features/companies/api'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'

// HW-25: a stale tab's Edit company must not overwrite what another tab saved.
const base = { name: 'Acme Traders', country: 'Pakistan', city: 'Lahore', notes: null }

function fake(current: Record<string, unknown>, updatedRows: unknown[] = [{ id: 'c1' }]) {
  return installFakeDb((c: FakeCall) => (c.verb === 'update' ? { data: updatedRows } : { data: current }))
}

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

describe('updateCompany with the values the form opened with', () => {
  it('sends only the changed field, guarded by updated_at, so Notes saved elsewhere survive a City change', async () => {
    const db = fake({ ...base, notes: 'Saved from the other tab', updated_at: 'v2' })
    await updateCompany('c1', { ...base, city: 'Multan' }, base)
    const update = db.calls.find(c => c.verb === 'update')!
    expect(opArgs(update, 'update')).toEqual([{ city: 'Multan' }])
    expect(update.ops.filter(([n]) => n === 'eq').map(([, a]) => a)).toEqual([
      ['id', 'c1'],
      ['updated_at', 'v2'],
    ])
  })

  it('refuses when someone else changed the same field meanwhile', async () => {
    const db = fake({ ...base, city: 'Karachi', updated_at: 'v2' })
    await expect(updateCompany('c1', { ...base, city: 'Multan' }, base)).rejects.toMatchObject({ code: STALE_EDIT, message: expect.stringContaining('Changed by someone else') })
    expect(db.calls.some(c => c.verb === 'update')).toBe(false)
  })

  it('refuses when a change lands between the read and the write (no row matched updated_at)', async () => {
    fake({ ...base, updated_at: 'v2' }, [])
    await expect(updateCompany('c1', { ...base, city: 'Multan' }, base)).rejects.toMatchObject({ code: STALE_EDIT })
  })

  it('writes nothing when nothing changed', async () => {
    const db = fake({ ...base, updated_at: 'v2' })
    await updateCompany('c1', { ...base }, base)
    expect(db.calls).toHaveLength(0)
  })
})
