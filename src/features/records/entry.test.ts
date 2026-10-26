import { describe, expect, it } from 'vitest'
import { entryAccess } from '@/features/records/entry'

const names = { u2: 'Ayesha Rana' }

describe('entryAccess (0092 whose-is-it rule)', () => {
  it('an admin may change anything', () => {
    expect(entryAccess({ id: 'a', role: 'admin' }, { createdBy: 'u2', ownerId: null }, names)).toEqual({ can: true, note: null })
    expect(entryAccess({ id: 'a', role: 'admin' }, { createdBy: null, ownerId: null }, names).can).toBe(true)
  })
  it('sales and engineers may change what they entered or own', () => {
    expect(entryAccess({ id: 'u1', role: 'sales' }, { createdBy: 'u1', ownerId: null }, names).can).toBe(true)
    expect(entryAccess({ id: 'u1', role: 'engineer' }, { createdBy: 'u2', ownerId: 'u1' }, names).can).toBe(true)
  })
  it('anyone else is told whose it is', () => {
    expect(entryAccess({ id: 'u1', role: 'sales' }, { createdBy: 'u2', ownerId: null }, names)).toEqual({
      can: false,
      note: 'Entered by Ayesha Rana: only they or an admin can change this',
    })
  })
  it('an imported row (no creator) is an admin\'s', () => {
    const a = entryAccess({ id: 'u1', role: 'sales' }, { createdBy: null, ownerId: null }, names)
    expect(a.can).toBe(false)
    expect(a.note).toMatch(/only an admin/)
  })
  it('does not name anyone before the names have loaded', () => {
    expect(entryAccess({ id: 'u1', role: 'sales' }, { createdBy: 'u2', ownerId: null }, undefined).note).toMatch(/Entered by someone else/)
  })
  it('signed out may change nothing', () => {
    expect(entryAccess(null, { createdBy: 'u1', ownerId: null }, names).can).toBe(false)
  })
})
