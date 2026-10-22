import { describe, expect, it } from 'vitest'
import { knownParam } from './urlParams'

describe('knownParam', () => {
  const allowed = ['open', 'part'] as const
  it('keeps a known value', () => expect(knownParam('open', allowed, 'all')).toBe('open'))
  it('ignores an unknown value', () => expect(knownParam('bogus', allowed, 'all')).toBe('all'))
  it('ignores a missing value', () => expect(knownParam(null, allowed, 'all')).toBe('all'))
  it('is case-sensitive, like the values the app writes', () => expect(knownParam('OPEN', allowed, 'all')).toBe('all'))
})
