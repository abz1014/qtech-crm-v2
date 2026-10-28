import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const catData = vi.fn((...args: unknown[]) => ({ data: undefined, n: args.length }))
vi.mock('@/features/rfqs/hooks', () => ({
  useCuratedCategories: () => ({ data: [] }),
  useSupplierCategoryData: (...args: unknown[]) => catData(...args),
}))

import { useSuggestionExtras } from './useSuggestionExtras'

describe('RFQ-5: recent asks are read even when no item has a category', () => {
  it('enables the extras query with no family ids', () => {
    const lib = { withCategories: (items: readonly unknown[]) => items } as never
    const items = [{ key: 'k1', description: 'Widget XYZ', brandId: 'b1', familyId: null }] as never
    renderHook(() => useSuggestionExtras(items, [{ id: 's1' }] as never, '2026-10-28', true, lib))
    const call = catData.mock.calls[0] as unknown[]
    expect(call[0]).toEqual([])
    expect(call[3]).toBe(true)
  })
})
