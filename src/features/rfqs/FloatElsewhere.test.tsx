import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FloatElsewhere, type EscalationItem } from '@/features/rfqs/FloatElsewhere'

const h = vi.hoisted(() => ({ memoryArgs: [] as unknown[][], partial: false }))
const stat = (id: string, brandIds: string[]) => ({ supplier_id: id, asked: 0, replied: 0, median_reply_days: null, last_contact: null, brand_ids: brandIds, brand_names: [] })
vi.mock('@/features/rfqs/hooks', () => ({
  useSupplierCandidates: () => ({
    isPending: false,
    isSuccess: true,
    data: [
      { id: 's-flow', name: 'Flow Shortlist Traders', city: 'Lahore', stats: { ...stat('s-flow', ['fam-flow']), brand_names: ['Flow meters'] } },
      // The customer the RFQ is for, tagged for the same category: never someone else to ask.
      { id: 'c-customer', name: 'The Customer Ltd', city: null, stats: stat('c-customer', ['fam-flow']) },
      // Untagged, but it has quoted this category before: the category group forms from the evidence.
      { id: 's-quoted', name: 'Quoted Before Co', city: null, stats: stat('s-quoted', []) },
    ],
  }),
  useSupplierMemory: (...args: unknown[]) => {
    h.memoryArgs.push(args)
    return { isPending: false, isSuccess: true, data: {} }
  },
  useCuratedCategories: () => ({ data: [], isError: false }),
  useSupplierCategoryData: () => ({
    isError: false,
    data: {
      evidence: [{ supplier_id: 's-quoted', family_id: 'fam-flow', asked: 3, replied: 3, quoted: 3, no_offer: 0, ordered: 0, last_asked_on: null }],
      manualTags: [],
      recentAsks: {},
      partial: h.partial,
    },
  }),
}))

const ITEM: EscalationItem = { id: 'it1', number: 1, description: 'Electromagnetic flow meter DN50', brandId: null, brandName: null, familyId: 'fam-flow', familyName: 'Flow meters', qty: 1, unit: null }
const props = { supplierName: 'Old Supplier', items: [ITEM], rfqId: 'rfq-1', customerId: 'c-customer', askedIds: new Set<string>(), today: '2026-10-19', onChoose: () => {}, onChaseAgain: () => {} }

describe('FloatElsewhere', () => {
  it('suggests a supplier shortlisted for the item family and asks memory with the family', () => {
    render(<FloatElsewhere {...props} />)
    expect(screen.getByText(/Flow Shortlist Traders/)).toBeInTheDocument()
    const query = h.memoryArgs.at(-1)?.[0] as Array<{ familyId: string | null }>
    expect(query[0]?.familyId).toBe('fam-flow')
  })

  it('never suggests the customer, and leaves this RFQ out of the memory', () => {
    render(<FloatElsewhere {...props} />)
    expect(screen.queryByText(/The Customer Ltd/)).not.toBeInTheDocument()
    expect(h.memoryArgs.at(-1)?.[3]).toBe('rfq-1')
    const supplierIds = h.memoryArgs.at(-1)?.[1] as string[]
    expect(supplierIds).not.toContain('c-customer')
  })

  it('reads the category evidence, so a supplier that quoted the category is suggested with that reason', () => {
    render(<FloatElsewhere {...props} />)
    expect(screen.getByText(/Quoted Before Co/)).toBeInTheDocument()
    expect(screen.getByText(/Deals in flow meters: quoted 3 of 3/)).toBeInTheDocument()
  })

  it('says so when some history did not load', () => {
    h.partial = true
    render(<FloatElsewhere {...props} />)
    expect(screen.getByText('Some history did not load, so the order may be incomplete.')).toBeInTheDocument()
    h.partial = false
  })
})
