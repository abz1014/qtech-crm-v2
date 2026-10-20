import { describe, expect, it } from 'vitest'
import { commonCountry } from '@/features/companies/commonCountry'

const rows = (...c: (string | null)[]) => c.map(country => ({ country }))

describe('commonCountry (pre-fill for the new-company dialog)', () => {
  it('says nothing without enough companies to go on', () => {
    expect(commonCountry(undefined)).toBeNull()
    expect(commonCountry(rows('Pakistan', 'Pakistan', 'Pakistan'))).toBeNull()
  })
  it('names the country at least half of them share', () => {
    expect(commonCountry(rows('Pakistan', 'Pakistan', 'Pakistan', 'China', null))).toBe('Pakistan')
  })
  it('counts the same country written in another case as one (free text)', () => {
    expect(commonCountry(rows('Pakistan', 'pakistan', 'PAKISTAN', 'China', null))).toBe('Pakistan')
  })
  it('stays blank when no country is a clear majority', () => {
    expect(commonCountry(rows('Pakistan', 'China', 'Germany', 'Austria', null, null))).toBeNull()
  })
})
