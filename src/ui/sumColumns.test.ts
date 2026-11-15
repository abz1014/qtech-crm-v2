import { describe, expect, it } from 'vitest'
import { evenColumns } from '@/ui/sumColumns'

describe('evenColumns (SumBar tiles per row)', () => {
  it('takes every tile on one row when they fit', () => {
    expect(evenColumns(4, 1000, 200)).toBe(4)
  })
  it('never leaves a lone tile: four go 4, 2 or 1, three go 3 or 1', () => {
    expect(evenColumns(4, 700, 200)).toBe(2)
    expect(evenColumns(4, 300, 200)).toBe(1)
    expect(evenColumns(3, 500, 200)).toBe(1)
  })
  it('lets a last row of three or more be one short (5 -> 3 + 2)', () => {
    expect(evenColumns(5, 700, 200)).toBe(3)
    expect(evenColumns(5, 500, 200)).toBe(1)
  })
  it('counts the hairline between tiles', () => {
    expect(evenColumns(2, 400, 200)).toBe(1)
    expect(evenColumns(2, 401, 200)).toBe(2)
  })
})
