import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { JobData } from '@/features/jobs/useJobData'
import { MoneyPanel } from '@/features/jobs/JobSide'
import { latestQuotation } from '@/features/jobs/lib/latestQuotation'

/*
 * "Money for this job" sat on Loading forever on an enquiry-stage job: with no order the order-money query is switched off, so it
 * is pending for good. The card must not wait for a query that will never run.
 */
const q = (over: Partial<{ issuedOn: string; revision: number; netTotal: number; gstTotal: number }> = {}) => ({ issuedOn: '2026-10-20', revision: 0, netTotal: 100000, gstTotal: 18000, ...over })
const money = { grossTarget: 1392400, settled: 417720, balance: 974680, paymentState: 'part', dueOn: null, netSale: 1180000, actualCost: 0, expectedCost: null, costsState: 'provisional', margin: null, marginState: 'provisional' }

function data(orderMoney: Partial<{ data: unknown; isPending: boolean; isError: boolean; refetch: () => void }>, quotations: unknown[] | undefined = []): JobData {
  return {
    orderMoney: { data: undefined, isPending: false, isError: false, refetch: vi.fn(), ...orderMoney },
    quotations: { data: quotations },
  } as unknown as JobData
}

describe('Money for this job', () => {
  it('enquiry with no order: leaves Loading at once, with plain words', () => {
    // the disabled query's real state in TanStack Query v5: pending, never fetching
    render(<MoneyPanel data={data({ isPending: true })} hasOrder={false} />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(/Loading/)).toBeNull()
    expect(screen.getByText('No money yet: no quotation has been sent.')).toBeInTheDocument()
  })

  it('enquiry with a quotation sent: shows the quoted value with GST, and that nothing is owed yet', () => {
    render(<MoneyPanel data={data({ isPending: true }, [q(), q({ revision: 1, netTotal: 200000, gstTotal: 36000 })])} hasOrder={false} />)
    expect(screen.getByText('Quoted (with GST)')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Money for this job' })).toHaveTextContent('236,000')
    expect(screen.getByText(/Nothing is owed until the customer places an order/)).toBeInTheDocument()
  })

  it('latestQuotation takes the newest issue date, then the highest revision', () => {
    expect(latestQuotation(undefined)).toBeNull()
    expect(latestQuotation([])).toBeNull()
    const rows = [q({ revision: 2 }), q({ issuedOn: '2026-10-25' }), q({ revision: 1 })]
    expect(latestQuotation(rows)).toBe(rows[1])
    expect(latestQuotation([q({ revision: 0 }), q({ revision: 3 })])?.revision).toBe(3)
  })

  it('an order whose money is still loading shows the loading skeleton', () => {
    render(<MoneyPanel data={data({ isPending: true })} hasOrder />)
    expect(screen.getByRole('status', { name: 'Loading the money for this job' })).toBeInTheDocument()
  })

  it('an order whose money could not be read says so and offers Try again', async () => {
    const refetch = vi.fn()
    render(<MoneyPanel data={data({ isPending: false, isError: true, refetch })} hasOrder />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText(/Could not load the money for this job/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('an ordered or paid job shows the sale, what is received and what is still to collect', () => {
    render(<MoneyPanel data={data({ data: money })} hasOrder />)
    const card = screen.getByRole('region', { name: 'Money for this job' })
    expect(card).toHaveTextContent('Sale (with GST)')
    expect(card).toHaveTextContent('974,680')
    expect(card).toHaveTextContent('Costs not entered yet')
    expect(screen.queryByText(/Loading/)).toBeNull()
  })

  it('a paid job (balance 0) shows the money, not an empty state', () => {
    render(<MoneyPanel data={data({ data: { ...money, settled: 1392400, balance: 0, paymentState: 'paid' } })} hasOrder />)
    expect(screen.getByText('Still to collect')).toBeInTheDocument()
    expect(screen.queryByText(/No money yet/)).toBeNull()
  })
})
