import { describe, expect, it } from 'vitest'
import { legLabel } from '@/features/orders/lib/legModel'

const leg = (id: string, supplierId: string, currency: string | null, supplierName = 'Gulf Instrumentation') => ({ id, supplierId, supplierName, currency })

describe('legLabel (HW-59)', () => {
  it('is the supplier alone when the order has one supplier order of it', () => {
    const a = leg('1', 's1', 'USD')
    expect(legLabel(a, [a, leg('2', 's2', 'PKR', 'Other Co')])).toBe('Gulf Instrumentation')
  })

  it('adds the currency when the same supplier has two supplier orders', () => {
    const usd = leg('1', 's1', 'USD')
    const eur = leg('2', 's1', 'EUR')
    expect(legLabel(usd, [usd, eur])).toBe('Gulf Instrumentation (USD)')
    expect(legLabel(eur, [usd, eur])).toBe('Gulf Instrumentation (EUR)')
  })

  it('says so when a currency is not set yet', () => {
    const a = leg('1', 's1', null)
    expect(legLabel(a, [a, leg('2', 's1', 'USD')])).toBe('Gulf Instrumentation (no currency)')
  })
})
