import { describe, expect, it } from 'vitest'
import { initials } from '@/lib/initials'

describe('initials', () => {
  it('takes first and last name', () => expect(initials('Ayesha Rana')).toBe('AR'))
  it('ignores middle names and extra spaces', () => expect(initials('  Farhan  Ali  Mirza ')).toBe('FM'))
  it('uses two letters of a single name', () => expect(initials('bilal')).toBe('BI'))
  it('falls back to a question mark', () => expect(initials('   ')).toBe('?'))
})
