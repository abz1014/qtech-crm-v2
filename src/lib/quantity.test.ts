import { describe, expect, it } from 'vitest'
import { isCountUnit, qtyNumber, qtyWithUnit, unitWord } from './quantity'

describe('quantity', () => {
  it.each([
    [1, null, '1 no'],
    [1, '', '1 no'],
    [2, undefined, '2 nos'],
    [1, 'nos', '1 no'],
    [2, 'no', '2 nos'],
    [2, 'pcs', '2 nos'],
    [1, 'PCS', '1 no'],
    [3, 'each', '3 nos'],
    [4, 'ea', '4 nos'],
    [150, 'm', '150 m'],
    [2.5, ' kg ', '2.5 kg'],
    [1200, 'set', '1,200 set'],
  ])('%s %s -> %s', (q, u, want) => expect(qtyWithUnit(q, u)).toBe(want))

  it('the unit word alone, for a muted span beside the number', () => {
    expect(unitWord(1, 'pcs')).toBe('no')
    expect(unitWord(0.5, null)).toBe('nos')
    expect(unitWord(3, 'Lot')).toBe('Lot')
  })

  it('counted units', () => {
    expect(isCountUnit(null)).toBe(true)
    expect(isCountUnit('Nos')).toBe(true)
    expect(isCountUnit('m')).toBe(false)
  })

  it('the number keeps up to 3 decimals', () => {
    expect(qtyNumber(0.1234)).toBe('0.123')
    expect(qtyNumber(1000)).toBe('1,000')
  })
})
