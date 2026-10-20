import { describe, expect, it } from 'vitest'
import { repeatedNote, skipRepeats } from '@/features/rfqs/lib/skipRepeats'

describe('skipRepeats', () => {
  it('skips lines already in the list, ignoring case and spacing, and counts them', () => {
    const existing = [{ description: 'Thermowell SS316 250 mm', qty: 3, unit: 'nos' }]
    const parsed = [
      { description: 'thermowell  SS316 250 mm ', qty: 3, unit: 'nos' },
      { description: 'Thermowell SS316 250 mm', qty: 4, unit: 'nos' },
    ]
    expect(skipRepeats(existing, parsed)).toEqual({ fresh: [parsed[1]], repeated: 1 })
    expect(repeatedNote(1)).toBe('1 line was already there')
    expect(repeatedNote(2)).toBe('2 lines were already there')
  })
})
