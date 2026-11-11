import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ result: { data: undefined, isError: false } as { data: unknown; isError: boolean } }))
const catData = vi.fn((...args: unknown[]) => ({ ...h.result, n: args.length }))
vi.mock('@/features/rfqs/hooks', () => ({
  useCuratedCategories: () => ({ data: [] }),
  useSupplierCategoryData: (...args: unknown[]) => catData(...args),
}))

import { useSuggestionExtras } from './useSuggestionExtras'

const lib = { withCategories: (items: readonly unknown[]) => items } as never
const items = [{ key: 'k1', description: 'Widget XYZ', brandId: 'b1', familyId: null }] as never
const run = () => renderHook(() => useSuggestionExtras(items, [{ id: 's1' }] as never, '2026-10-28', true, lib)).result.current

describe('RFQ-5: recent asks are read even when no item has a category', () => {
  it('enables the extras query with no family ids', () => {
    renderHook(() => useSuggestionExtras(items, [{ id: 's1' }] as never, '2026-10-28', true, lib))
    const call = catData.mock.calls[0] as unknown[]
    expect(call[0]).toEqual([])
    expect(call[3]).toBe(true)
  })
})

describe('a ranking read that failed is reported, not silent', () => {
  it('is not partial when every read loaded', () => {
    h.result = { data: { evidence: [], manualTags: [], recentAsks: {}, partial: false }, isError: false }
    expect(run().partial).toBe(false)
  })

  it('is partial when one read failed, and keeps what the others returned', () => {
    h.result = { data: { evidence: [{ supplier_id: 's1' }], manualTags: undefined, recentAsks: { s1: ['other'] }, partial: true }, isError: false }
    const r = run()
    expect(r.partial).toBe(true)
    expect(r.extra.categoryEvidence).toHaveLength(1)
    expect(r.extra.recentAsks).toEqual({ s1: ['other'] })
  })

  it('is partial when the whole query errored', () => {
    h.result = { data: undefined, isError: true }
    expect(run().partial).toBe(true)
  })
})
