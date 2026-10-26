import { describe, expect, it } from 'vitest'
import { dealtRows, evidenceText } from '@/features/companies/dealtInModel'

const ev = (familyId: string, name: string, o: Partial<{ asked: number; replied: number; quoted: number; ordered: number }> = {}) => ({ familyId, name, asked: 0, replied: 0, quoted: 0, ordered: 0, ...o })

describe('categories a supplier deals in', () => {
  it('says the evidence in words', () => {
    expect(evidenceText(ev('a', 'A', { quoted: 6, ordered: 2 }))).toBe('quoted 6 · ordered 2')
    expect(evidenceText(ev('a', 'A', { quoted: 1 }))).toBe('quoted 1')
    expect(evidenceText(ev('a', 'A', { ordered: 3 }))).toBe('ordered 3')
    expect(evidenceText(ev('a', 'A', { asked: 3 }))).toBe('asked 3, no quote yet')
    expect(evidenceText(undefined)).toBe('no history yet')
  })

  it('lists evidence first (orders, then quotes), then asked-only, then a tag with nothing behind it', () => {
    const rows = dealtRows(
      [ev('c', 'Cables', { asked: 2 }), ev('p', 'Pressure transmitters', { quoted: 6, ordered: 2 }), ev('m', 'MCB', { quoted: 9 })],
      [{ brandId: 'k', name: 'Contactors', kind: 'family' }, { brandId: 'p', name: 'Pressure transmitters', kind: 'family' }, { brandId: 'b1', name: 'Belimo', kind: 'brand' }],
    )
    expect(rows.map(r => [r.name, r.evidence, r.tagged])).toEqual([
      ['Pressure transmitters', 'quoted 6 · ordered 2', true],
      ['MCB', 'quoted 9', false],
      ['Cables', 'asked 2, no quote yet', false],
      ['Contactors', 'no history yet', true],
    ])
  })

  it('never lists a brand', () => {
    expect(dealtRows([], [{ brandId: 'b1', name: 'Belimo', kind: 'brand' }])).toEqual([])
  })
})
