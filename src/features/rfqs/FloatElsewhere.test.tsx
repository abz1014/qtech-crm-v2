import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FloatElsewhere, type EscalationItem } from '@/features/rfqs/FloatElsewhere'

const h = vi.hoisted(() => ({ memoryArgs: [] as unknown[][] }))
vi.mock('@/features/rfqs/hooks', () => ({
  useSupplierCandidates: () => ({
    isPending: false,
    isSuccess: true,
    data: [
      {
        id: 's-flow',
        name: 'Flow Shortlist Traders',
        city: 'Lahore',
        stats: { supplier_id: 's-flow', asked: 0, replied: 0, median_reply_days: null, last_contact: null, brand_ids: ['fam-flow'], brand_names: ['Flow meters'] },
      },
    ],
  }),
  useSupplierMemory: (...args: unknown[]) => {
    h.memoryArgs.push(args)
    return { isPending: false, isSuccess: true, data: {} }
  },
}))

const ITEM: EscalationItem = { id: 'it1', number: 1, description: 'Electromagnetic flow meter DN50', brandId: null, brandName: null, familyId: 'fam-flow', familyName: 'Flow meters', qty: 1, unit: null }

describe('FloatElsewhere', () => {
  it('suggests a supplier shortlisted for the item family and asks memory with the family', () => {
    render(<FloatElsewhere supplierName="Old Supplier" items={[ITEM]} askedIds={new Set()} today="2026-10-19" onChoose={() => {}} onChaseAgain={() => {}} />)
    expect(screen.getByText(/Flow Shortlist Traders/)).toBeInTheDocument()
    const query = h.memoryArgs.at(-1)?.[0] as Array<{ familyId: string | null }>
    expect(query[0]?.familyId).toBe('fam-flow')
  })
})
