import { describe, expect, it } from 'vitest'
import { DEFAULT_VISIT_TYPE, visitChanged, visitLine, visitPatch, visitTypeLabel, visitValueOf } from '@/features/orders/lib/visit'

describe('visit', () => {
  it('says the row as type, customer, site', () => {
    expect(visitLine({ type: 'installation', customer: 'Alpenmark Controls', site: 'Plant 2' })).toBe('Install · Alpenmark Controls · Plant 2')
  })
  it('leaves out what is not set', () => {
    expect(visitLine({ type: 'survey', customer: 'Alpenmark Controls', site: null })).toBe('Survey · Alpenmark Controls')
    expect(visitLine({ type: null, customer: 'Alpenmark Controls' })).toBe('Alpenmark Controls')
  })
  it('has no time of day anywhere', () => {
    expect(Object.keys(visitPatch({ type: 'service' }))).toEqual(['visit_type'])
    expect(Object.keys(visitValueOf({ visitType: 'service' }))).toEqual(['type'])
  })
  it('is an installation unless somebody says otherwise', () => {
    expect(DEFAULT_VISIT_TYPE).toBe('installation')
    expect(visitTypeLabel('survey')).toBe('Survey')
    expect(visitTypeLabel('nonsense')).toBe('')
  })
  it('only an unknown type is written as nothing', () => {
    expect(visitPatch({ type: 'party' })).toEqual({ visit_type: null })
    expect(visitChanged({ type: 'survey' }, { type: 'service' })).toBe(true)
    expect(visitChanged({ type: 'survey' }, { type: 'survey' })).toBe(false)
  })
})
