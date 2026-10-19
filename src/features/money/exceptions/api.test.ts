import { describe, expect, it } from 'vitest'
import { computeReconciliationExceptions } from '@/lib/reconciliation'
import { EMPTY_RECONCILIATION_INPUT, toReconciliationInput } from './api'

describe('toReconciliationInput (the jsonb of money_exceptions_input)', () => {
  it('reads NULL (anyone who is not an admin) as nothing to check', () => {
    expect(toReconciliationInput(null)).toEqual(EMPTY_RECONCILIATION_INPUT)
    expect(toReconciliationInput(undefined)).toEqual(EMPTY_RECONCILIATION_INPUT)
    expect(computeReconciliationExceptions(toReconciliationInput(null))).toEqual([])
  })

  it('reads a missing list as an empty one and passes the rows through unchanged', () => {
    const doc = {
      orders: [{ id: 'o1', number: 38, orderedOn: '2026-07-01', cancelled: false, basisUnknown: false }],
      money: [{ orderId: 'o1', grossTarget: 1000, settled: 1500, itemsNet: 0, itemsGross: 1000, invoiceCount: 0, invoiceGross: 0, expectedCost: null, actualCost: 0, costsComplete: true }],
    }
    const input = toReconciliationInput(doc)
    expect(input.payments).toEqual([])
    expect(input.legPaid).toEqual([])
    expect(computeReconciliationExceptions(input).map(e => e.category)).toEqual(['Payments exceed total'])
  })
})
