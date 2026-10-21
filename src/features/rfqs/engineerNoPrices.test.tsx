import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { seesPrices, SessionContext } from '@/app/session'
import { listInquiries } from '@/features/rfqs/api'
import { useFxLatest, useRfqInquiries, useSupplierMemory } from '@/features/rfqs/hooks'
import { useRankedQuotes } from '@/features/rfqs/ranking/hooks'
import { usePriceMemory, useQuotations, useQuoteItems } from '@/features/quotations/hooks'
import { useMyTarget } from '@/features/today/hooks'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'

/*
 * Owner decision 2026-10-22: an engineer sees no price anywhere, and the app does not even FETCH one for them. These tests hold
 * the fetch side on the RFQ page's reads: the quote lines come without price or rate, and the exchange rates, the ranking, the
 * supplier memory, the customer price memory and the quotations' lines and totals are never requested.
 */

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

const PRICE_COLUMNS = /\b(unit_price|fx_rate_pkr|fx_rate_on|net_total|gst_total|lines|quoted_unit_price_net)\b/

function wrapper(role: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Bilal', role } }}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SessionContext.Provider>
  )
}

function answer(c: FakeCall) {
  if (c.target === 'supplier_inquiries') return { data: [{ id: 'q1', supplier_id: 's1', sent_on: '2026-10-01', last_chased_on: null, last_chased_by: null, last_relayed_at: null, no_offer_on: null, no_offer_reason: null, chase_count: 0, notes: null, created_at: 't' }] }
  if (c.target === 'supplier_quote_lines') {
    const cols = String(opArgs(c, 'select')?.[0] ?? '')
    if (cols.includes('inquiry_id')) {
      return { data: [{ id: 'l1', inquiry_id: 'q1', rfq_item_id: 'i1', currency: 'USD', lead_time: '2 weeks', in_stock: true, ...(cols.includes('unit_price') ? { unit_price: 99, fx_rate_pkr: 280, fx_rate_on: '2026-10-01' } : {}) }] }
    }
  }
  return { data: [] }
}

function useRfqPageReads(rfqId: string) {
  return {
    inquiries: useRfqInquiries(rfqId),
    fx: useFxLatest(),
    ranking: useRankedQuotes(rfqId, true),
    memory: useSupplierMemory([{ key: 'i1', description: 'Valve', brandId: null, familyId: null }], ['s1'], true, rfqId),
    quotations: useQuotations(rfqId),
    quoteItems: useQuoteItems(rfqId, true),
    priceMemory: usePriceMemory(rfqId, true),
    target: useMyTarget(false),
  }
}

describe('seesPrices', () => {
  it('admin and sales see prices; an engineer, an unknown role and nobody do not', () => {
    expect(seesPrices('admin')).toBe(true)
    expect(seesPrices('sales')).toBe(true)
    expect(seesPrices('engineer')).toBe(false)
    expect(seesPrices('intern')).toBe(false)
    expect(seesPrices(null)).toBe(false)
    expect(seesPrices(undefined)).toBe(false)
  })
})

describe('the RFQ page reads, by role (owner decision 2026-10-22)', () => {
  it('listInquiries without prices asks for no price or rate column and returns lines with no price', async () => {
    const db = installFakeDb(answer)
    const rows = await listInquiries('r1', false)
    const lineSelect = db.calls.filter(c => c.target === 'supplier_quote_lines').map(c => String(opArgs(c, 'select')?.[0]))
    expect(lineSelect.length).toBeGreaterThan(0)
    for (const cols of lineSelect) expect(cols).not.toMatch(PRICE_COLUMNS)
    expect(rows[0].lines[0]).toMatchObject({ unitPrice: 0, fxRatePkr: null, fxRateOn: null, leadTime: '2 weeks', inStock: true })
  })

  it('an engineer: no rates, ranking, supplier memory, price memory or priced quotation read is ever requested', async () => {
    const db = installFakeDb(answer)
    const { result } = renderHook(() => useRfqPageReads('r1'), { wrapper: wrapper('engineer') })
    await waitFor(() => expect(result.current.inquiries.isSuccess && result.current.quotations.isSuccess).toBe(true))
    const targets = db.calls.map(c => c.target)
    for (const t of ['v_fx_latest', 'rpc:rank_item_quotes', 'rpc:supplier_item_memory', 'rpc:customer_price_memory', 'rpc:my_target_progress', 'rfq_items']) expect(targets).not.toContain(t)
    for (const c of db.calls) expect(String(opArgs(c, 'select')?.[0] ?? '')).not.toMatch(PRICE_COLUMNS)
  })

  it('sales: the same reads do ask for the prices', async () => {
    const db = installFakeDb(answer)
    const { result } = renderHook(() => useRfqPageReads('r1'), { wrapper: wrapper('sales') })
    await waitFor(() => expect(result.current.inquiries.isSuccess && result.current.ranking.isSuccess && result.current.fx.isSuccess).toBe(true))
    const targets = db.calls.map(c => c.target)
    for (const t of ['v_fx_latest', 'rpc:rank_item_quotes', 'rpc:supplier_item_memory', 'rpc:customer_price_memory']) expect(targets).toContain(t)
    expect(db.calls.some(c => c.target === 'supplier_quote_lines' && /unit_price/.test(String(opArgs(c, 'select')?.[0])))).toBe(true)
    expect(db.calls.some(c => c.target === 'quotations' && /net_total/.test(String(opArgs(c, 'select')?.[0])))).toBe(true)
  })
})
