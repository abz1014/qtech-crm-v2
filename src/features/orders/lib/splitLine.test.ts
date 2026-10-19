import { describe, expect, it } from 'vitest'
import { supplierTargetProblem } from '@/features/orders/lib/splitLine'

describe('Split line (O09): moving to a supplier by hand', () => {
  const source = { supplierId: 's1', currency: 'PKR' }

  it('refuses the line\'s own supplier in the leg\'s own currency: split_order_item would open a second leg for the same supplier and currency', () => {
    expect(supplierTargetProblem(source, 's1', 'PKR')).toMatch(/already/)
  })

  it('allows the same supplier in another currency, and any other supplier', () => {
    expect(supplierTargetProblem(source, 's1', 'USD')).toBeNull()
    expect(supplierTargetProblem(source, 's2', 'PKR')).toBeNull()
    expect(supplierTargetProblem(undefined, 's1', 'PKR')).toBeNull()
  })

  it('treats a leg with no currency yet as matching nothing typed but an empty currency', () => {
    expect(supplierTargetProblem({ supplierId: 's1', currency: null }, 's1', 'PKR')).toBeNull()
  })
})
