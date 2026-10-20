import { describe, expect, it } from 'vitest'
import { matchCompany, phoneKey, type SearchableCompany } from '@/features/companies/companySearch'

const glass: SearchableCompany = {
  name: 'Karachi Glassworks',
  city: 'Karachi',
  country: 'Pakistan',
  contacts: [
    { name: 'Naveed Akhtar', phoneKey: phoneKey('+92 301 555 0142') },
    { name: 'Salman Khan', phoneKey: phoneKey('0300 1234567') },
    { name: 'Front desk', phoneKey: '' },
  ],
}
const linz: SearchableCompany = { name: 'Alpenmark GmbH', city: 'Linz', country: 'Austria', contacts: [{ name: 'Eva Huber', phoneKey: phoneKey('+43 732 123456') }] }

describe('phoneKey', () => {
  it('drops the marks, the + or 00, Pakistan 92 and the trunk 0', () => {
    expect(phoneKey('+92 301 555 0142')).toBe('3015550142')
    expect(phoneKey('0301-5550142')).toBe('3015550142')
    expect(phoneKey('0092 301 5550142')).toBe('3015550142')
    expect(phoneKey('923015550142')).toBe('3015550142')
    expect(phoneKey('(021) 3456 7890')).toBe('2134567890')
    expect(phoneKey('+43 732 123456')).toBe('43732123456')
  })
  it('is empty for no phone', () => {
    expect(phoneKey(null)).toBe('')
    expect(phoneKey('')).toBe('')
  })
})

describe('matchCompany (the Companies list search)', () => {
  it('matches everything when nothing is typed', () => {
    expect(matchCompany(glass, '   ')).toEqual({ contact: null })
  })

  it('matches the name, city and country, in any case and word order', () => {
    expect(matchCompany(glass, 'glass')).toEqual({ contact: null })
    expect(matchCompany(glass, 'WORKS karachi')).toEqual({ contact: null })
    expect(matchCompany(linz, 'linz')).toEqual({ contact: null })
    expect(matchCompany(linz, 'austria alpen')).toEqual({ contact: null })
  })

  it('needs every word to match something', () => {
    expect(matchCompany(glass, 'glass lahore')).toBeNull()
    expect(matchCompany(linz, 'alpen naveed')).toBeNull()
  })

  it('finds a company by a contact name and says which contact', () => {
    expect(matchCompany(glass, 'naveed')).toEqual({ contact: 'Naveed Akhtar' })
    expect(matchCompany(glass, 'glass salman')).toEqual({ contact: 'Salman Khan' })
  })

  it('finds a company by a phone number typed with 0 or with +92, spaces or not', () => {
    for (const typed of ['0301 5550142', '03015550142', '+92 301 555 0142', '+923015550142', '0301-555-0142', '301 555 0142', '5550142']) {
      expect(matchCompany(glass, typed), typed).toEqual({ contact: 'Naveed Akhtar' })
    }
    expect(matchCompany(glass, '0300 1234567')).toEqual({ contact: 'Salman Khan' })
    expect(matchCompany(linz, '0043 732')).toEqual({ contact: 'Eva Huber' })
  })

  it('works the other way round: a number saved with 0 is found by +92', () => {
    expect(matchCompany(glass, '+92 300 123 4567')).toEqual({ contact: 'Salman Khan' })
  })

  it('needs 4 digits before a number is read as a phone', () => {
    expect(matchCompany(glass, '301')).toBeNull()
    expect(matchCompany(glass, '0142')).toEqual({ contact: 'Naveed Akhtar' })
  })

  it('a number in the name still matches as text', () => {
    const expo: SearchableCompany = { name: 'Expo 2026 Supplies', city: null, country: null, contacts: [] }
    expect(matchCompany(expo, 'expo 2026')).toEqual({ contact: null })
    expect(matchCompany(expo, '2027')).toBeNull()
  })

  it('a wrong number does not match', () => {
    expect(matchCompany(glass, '0301 9999999')).toBeNull()
  })
})
