import { describe, expect, it } from 'vitest'
import { initials } from '@/lib/initials'

describe('initials', () => {
  it('takes first and last name', () => expect(initials('Ayesha Rana')).toBe('AR'))
  it('ignores middle names and extra spaces', () => expect(initials('  Farhan  Ali  Mirza ')).toBe('FM'))
  it('uses two letters of a single name', () => expect(initials('bilal')).toBe('BI'))
  it('falls back to a question mark', () => expect(initials('   ')).toBe('?'))
  // HE-15: never half a surrogate pair.
  const noLoneSurrogate = (s: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s)
  it('passes over an emoji word when the name has letters', () => expect(initials('Hunt Emoji 😀')).toBe('HE'))
  it('keeps an emoji whole when it is all there is', () => {
    expect(initials('😀')).toBe('😀')
    expect(noLoneSurrogate(initials('😀😀😀'))).toBe(true)
  })
  it('keeps a flag whole', () => expect(initials('🇵🇰 Traders').startsWith('T')).toBe(true))
  it('handles an emoji glued to a name', () => {
    expect(initials('😀Ali')).toBe('😀A')
    expect(noLoneSurrogate(initials('😀Ali Khan'))).toBe(true)
  })
  it('reads Urdu names', () => expect(initials('عائشہ رانا')).toBe('عر'))
  it('keeps a letter with its combining mark', () => expect(initials('Zoé Émile')).toBe('ZÉ'))
})
