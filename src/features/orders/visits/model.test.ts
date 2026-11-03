import { describe, expect, it } from 'vitest'
import { canEditVisit, draftChanged, draftOf, draftPatch, emptyDraft, sortVisits, toVisit, visitState, type VisitRow } from '@/features/orders/visits/model'

const visit = (over: Partial<VisitRow> = {}): VisitRow => ({ id: 'v1', orderId: 'o1', type: 'installation', on: '2026-11-05', engineerId: 'e1', engineerName: 'Hamza Sheikh', notes: null, doneOn: null, ...over })

describe('visit drafts', () => {
  it('start as an installation with nothing else set', () => {
    expect(emptyDraft()).toEqual({ type: 'installation', on: '', engineerId: '', notes: '' })
  })

  it('write empty fields as null and trim the notes', () => {
    expect(draftPatch({ type: 'survey', on: '', engineerId: '', notes: '  ' })).toEqual({ visit_type: 'survey', visit_on: null, engineer_id: null, notes: null })
    expect(draftPatch({ type: 'service', on: '2026-11-09', engineerId: 'e2', notes: ' Gate pass at 3pm ' })).toEqual({ visit_type: 'service', visit_on: '2026-11-09', engineer_id: 'e2', notes: 'Gate pass at 3pm' })
  })

  it('know when nothing changed (spaces around the notes do not count)', () => {
    const v = visit({ notes: 'Bring ladder' })
    expect(draftChanged(draftOf(v), draftOf(v))).toBe(false)
    expect(draftChanged({ ...draftOf(v), notes: 'Bring ladder ' }, draftOf(v))).toBe(false)
    expect(draftChanged({ ...draftOf(v), on: '2026-11-06' }, draftOf(v))).toBe(true)
  })
})

describe('toVisit and sortVisits', () => {
  it('names the engineer and falls back to an installation for a type it does not know', () => {
    const v = toVisit({ id: 'v1', order_id: 'o1', visit_type: 'party', visit_on: null, engineer_id: 'e1', notes: null, done_on: null }, new Map([['e1', 'Hamza Sheikh']]))
    expect(v).toMatchObject({ type: 'installation', engineerName: 'Hamza Sheikh', on: null })
  })

  it('puts the oldest first and a visit with no date last', () => {
    const rows = sortVisits([visit({ id: 'c', on: null }), visit({ id: 'b', on: '2026-11-09' }), visit({ id: 'a', on: '2026-11-01' })])
    expect(rows.map(r => r.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('visitState', () => {
  it('is done, late, planned or not dated', () => {
    expect(visitState(visit({ doneOn: '2026-11-01' }), '2026-11-02')).toBe('done')
    expect(visitState(visit({ on: '2026-11-01' }), '2026-11-02')).toBe('late')
    expect(visitState(visit({ on: '2026-11-02' }), '2026-11-02')).toBe('planned')
    expect(visitState(visit({ on: null }), '2026-11-02')).toBe('unplanned')
  })
})

describe('canEditVisit (the database says the same)', () => {
  it('lets admin and sales change any visit', () => {
    expect(canEditVisit(visit(), { role: 'admin', id: 'a' }, false)).toBe(true)
    expect(canEditVisit(visit(), { role: 'sales', id: 's' }, false)).toBe(true)
  })

  it('lets an engineer change their own visit, not someone else’s', () => {
    expect(canEditVisit(visit({ engineerId: 'e1' }), { role: 'engineer', id: 'e1' }, true)).toBe(true)
    expect(canEditVisit(visit({ engineerId: 'e2' }), { role: 'engineer', id: 'e1' }, true)).toBe(false)
  })

  it('lets an engineer change a visit with nobody on it only on an order they are on', () => {
    expect(canEditVisit(visit({ engineerId: null }), { role: 'engineer', id: 'e1' }, true)).toBe(true)
    expect(canEditVisit(visit({ engineerId: null }), { role: 'engineer', id: 'e1' }, false)).toBe(false)
  })

  it('refuses everyone else', () => {
    expect(canEditVisit(visit(), { role: '', id: '' }, true)).toBe(false)
  })
})
