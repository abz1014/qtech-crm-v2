import { describe, expect, it } from 'vitest'
import type { JobRow } from '@/features/jobs/api'
import { byRecent, chipCounts, defaultChip, inChip, inStage, isStageFilter, itemsSummary, normalizeStage, stagesFor, STAGE_FILTERS, STAGE_LABEL, type StageFilter } from '@/features/jobs/lib/listModel'

const job = (over: Partial<JobRow>): JobRow => ({
  key: '1', kind: 'enquiry', rfqId: 'r', orderId: null, companyId: 'c', companyName: 'Customer', siteName: null, ownerId: 'u1', ownerName: 'A', items: 'x',
  stage: 'enquiry', stageDetail: null, isHistory: false, lastActivityOn: '2026-10-01', repeatOf: null, cancelledOrders: 0, engineerIds: [], ...over,
})
const me = { userId: 'u1', role: 'sales' as const }

describe('Jobs list chips', () => {
  const all = [job({ key: '1' }), job({ key: '2', ownerId: 'u2' }), job({ key: '3', isHistory: true, stage: 'paid' }), job({ key: 'O-4', ownerId: 'u2', engineerIds: ['u1'] })]
  it('History shows only is_history rows and Open and Mine never do', () => {
    expect(all.filter(j => inChip(j, 'history', me)).map(j => j.key)).toEqual(['3'])
    expect(all.filter(j => inChip(j, 'open', me)).map(j => j.key)).toEqual(['1', '2', 'O-4'])
    expect(all.filter(j => inChip(j, 'mine', me)).map(j => j.key)).toEqual(['1', 'O-4'])
  })
  it('counts each chip', () => {
    expect(chipCounts(all, me)).toEqual({ mine: 2, open: 3, history: 1 })
  })
  it('sales and engineers start on Mine, the admin on Open', () => {
    expect(defaultChip('sales')).toBe('mine')
    expect(defaultChip('engineer')).toBe('mine')
    expect(defaultChip('admin')).toBe('open')
  })
  it('sorts the newest activity first', () => {
    expect([job({ key: '1', lastActivityOn: '2026-01-01' }), job({ key: '2', lastActivityOn: '2026-02-01' })].sort(byRecent).map(j => j.key)).toEqual(['2', '1'])
  })
})

describe('Jobs list stage filters', () => {
  const at = (stage: string, stageDetail: string | null = null, over: Partial<JobRow> = {}) => job({ stage, stageDetail, orderId: 'o1', ...over })
  const filtersOf = (j: JobRow): StageFilter[] => STAGE_FILTERS.filter(s => inStage(j, s))

  it('puts every stage word in the filters the StageBar stop says', () => {
    expect(filtersOf(at('ordered', 'to source'))).toEqual(['orders', 'supplier'])
    expect(filtersOf(at('ordered'))).toEqual(['orders', 'supplier'])
    expect(filtersOf(at('supplier_ordered', 'waiting for supplier'))).toEqual(['orders', 'supplier'])
    expect(filtersOf(at('delivered', 'not invoiced yet'))).toEqual(['orders', 'invoice'])
    expect(filtersOf(at('invoiced', 'not paid yet'))).toEqual(['orders', 'payment'])
    expect(filtersOf(at('paid'))).toEqual(['orders'])
  })

  it('keeps a late supplier order under Waiting for supplier', () => {
    expect(inStage(at('supplier_ordered', 'supplier late'), 'supplier')).toBe(true)
    expect(inStage(at('supplier_ordered', 'supplier late, advance received'), 'supplier')).toBe(true)
  })

  it('moves a supplier order to To deliver once goods arrived or part arrived', () => {
    for (const d of ['arrived, not delivered', '2 of 3 delivered', 'supplier late, 1 of 2 delivered', 'arrived, not delivered, advance received']) {
      const j = at('supplier_ordered', d)
      expect(inStage(j, 'deliver')).toBe(true)
      expect(inStage(j, 'supplier')).toBe(false)
      expect(inStage(j, 'orders')).toBe(true)
    }
  })

  it('puts an invoice sent before the goods are delivered under To deliver or Waiting, never under To invoice', () => {
    expect(filtersOf(at('supplier_ordered', 'invoiced, waiting for supplier'))).toEqual(['orders', 'supplier'])
    expect(filtersOf(at('supplier_ordered', 'invoiced, arrived, not delivered'))).toEqual(['orders', 'deliver'])
  })

  it('treats a paid job with installation still to plan as finished (Orders only)', () => {
    expect(filtersOf(at('paid', 'installation to plan'))).toEqual(['orders'])
  })

  it('puts a delivered job with parallel details under To invoice only', () => {
    expect(filtersOf(at('delivered', 'partly invoiced, advance received'))).toEqual(['orders', 'invoice'])
  })

  it('puts an order job in Orders plus at most one other filter', () => {
    const words = ['ordered', 'supplier_ordered', 'delivered', 'invoiced', 'paid']
    for (const w of words) expect(filtersOf(at(w)).length).toBeLessThanOrEqual(2)
  })

  it('leaves lost, cancelled and enquiry-only jobs in no filter', () => {
    expect(filtersOf(at('cancelled', 'order cancelled'))).toEqual([])
    expect(filtersOf(at('lost', 'price too high', { orderId: null }))).toEqual([])
    expect(filtersOf(at('lost', 'price too high'))).toEqual([])
    for (const w of ['enquiry', 'asking_suppliers', 'prices_in', 'quoted']) expect(filtersOf(job({ stage: w, orderId: null }))).toEqual([])
  })

  it('does not put an order-less job in Orders, whatever its stage word', () => {
    expect(inStage(job({ stage: 'ordered', orderId: null }), 'orders')).toBe(false)
    expect(inStage(job({ stage: null, orderId: 'o1' }), 'orders')).toBe(false)
  })

  it('offers admin and sales six choices with All, engineers four', () => {
    expect(stagesFor('admin', 'open')).toEqual(['orders', 'supplier', 'deliver', 'invoice', 'payment'])
    expect(stagesFor('sales', 'mine')).toEqual(['orders', 'supplier', 'deliver', 'invoice', 'payment'])
    expect(stagesFor('engineer', 'mine')).toEqual(['orders', 'supplier', 'deliver'])
    expect(STAGE_FILTERS.map(s => STAGE_LABEL[s])).toEqual(['Orders', 'Waiting for supplier', 'To deliver', 'To invoice', 'To be paid'])
  })

  it('offers only Orders under History, for every role', () => {
    for (const r of ['admin', 'sales', 'engineer'] as const) expect(stagesFor(r, 'history')).toEqual(['orders'])
  })

  it('turns anything not offered into All', () => {
    expect(normalizeStage('invoice', 'engineer', 'open')).toBeNull()
    expect(normalizeStage('payment', 'engineer', 'mine')).toBeNull()
    expect(normalizeStage('deliver', 'admin', 'history')).toBeNull()
    expect(normalizeStage('nonsense', 'admin', 'open')).toBeNull()
    expect(normalizeStage('', 'admin', 'open')).toBeNull()
    expect(normalizeStage(null, 'admin', 'open')).toBeNull()
    expect(normalizeStage('invoice', 'admin', 'open')).toBe('invoice')
    expect(normalizeStage('orders', 'engineer', 'history')).toBe('orders')
    expect(isStageFilter('supplier')).toBe(true)
    expect(isStageFilter('all')).toBe(false)
  })
})

describe('itemsSummary', () => {
  it('turns "X +N more" into a count and the first item', () => {
    expect(itemsSummary('Flow meter RST 1158S +2 more')).toBe('3 items · Flow meter RST 1158S')
    expect(itemsSummary('Flow meter +1 more')).toBe('2 items · Flow meter')
    expect(itemsSummary('  Flow   meter  +12 more ')).toBe('13 items · Flow meter')
  })
  it('leaves a single item, an empty line and an old free-text note as they are (the caller clamps to one line)', () => {
    expect(itemsSummary('Pressure transmitter')).toBe('Pressure transmitter')
    expect(itemsSummary('')).toBe('')
    expect(itemsSummary(null)).toBe('')
    expect(itemsSummary('Old note: 2 pumps, 1 valve\nsee PO; delivered in two lots')).toBe('Old note: 2 pumps, 1 valve see PO; delivered in two lots')
  })
})
