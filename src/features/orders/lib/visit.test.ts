import { describe, expect, it } from 'vitest'
import { visitLine, visitTime } from '@/features/orders/lib/visit'

describe('visit', () => {
  it('reads a Postgres time as HH:MM and refuses what is not a time', () => {
    expect(visitTime('10:00:00')).toBe('10:00')
    expect(visitTime('09:30')).toBe('09:30')
    expect(visitTime('24:00')).toBeNull()
    expect(visitTime('')).toBeNull()
    expect(visitTime(null)).toBeNull()
  })
  it('says the row as time, type, customer, site', () => {
    expect(visitLine({ time: '10:00:00', type: 'installation', customer: 'Alpenmark Controls', site: 'Plant 2' })).toBe('10:00 · Install · Alpenmark Controls · Plant 2')
  })
  it('leaves out what is not set', () => {
    expect(visitLine({ time: null, type: 'survey', customer: 'Alpenmark Controls', site: null })).toBe('Survey · Alpenmark Controls')
    expect(visitLine({ time: null, type: null, customer: 'Alpenmark Controls' })).toBe('Alpenmark Controls')
  })
})
