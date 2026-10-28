import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RfqHeader } from '@/features/rfqs/api'

const orders = vi.hoisted(() => ({ value: { data: [] as Array<{ id: string; number: number; cancelledOn: string | null }>, isPending: false } }))
vi.mock('@/features/orders/forRfq', () => ({ useOrdersForRfq: () => orders.value }))
vi.mock('@/features/rfqs/hooks', () => ({ useUpdateRfqHeader: () => ({ mutateAsync: vi.fn(), isPending: false }) }))
vi.mock('@/features/companies/hooks', () => ({ useCompanySites: () => ({ data: [] }), useCompanyContacts: () => ({ data: [] }) }))
vi.mock('@/features/records/useEntryAccess', () => ({ useEntryAccess: () => ({ can: true, note: null }) }))
vi.mock('@/features/rfqs/CompanyPicker', () => ({ CompanyPicker: () => null }))
vi.mock('@/ui/useToast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

import { EditRfqDialog } from '@/features/rfqs/EditRfqDialog'

afterEach(cleanup)

const rfq = {
  id: 'r-1', number: 150, customerRef: null, receivedOn: '2026-10-01', company: { id: 'c-1', name: 'Alpha Test Co' }, siteId: null, contactId: null, owner: null, createdBy: null,
} as unknown as RfqHeader

describe('RFQ-3: the customer of an RFQ with an order', () => {
  it('can be changed when there is no order', () => {
    orders.value = { data: [], isPending: false }
    render(<EditRfqDialog rfq={rfq} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Change customer' })).toBeEnabled()
  })
  it('is locked, with a plain reason, once an order exists', () => {
    orders.value = { data: [{ id: 'o-1', number: 40, cancelledOn: null }], isPending: false }
    render(<EditRfqDialog rfq={rfq} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Change customer' })).toBeDisabled()
    expect(screen.getByText(/customer cannot be changed.*ORD-0040/)).toBeInTheDocument()
  })
})
