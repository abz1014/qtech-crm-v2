import { describe, expect, it } from 'vitest'
import { payHref } from '@/features/money/monthEnd/reportFiles'

const row = { state: 'owing' as const, orderId: 'o-1', legId: 'l-1', owedPkr: '384496.60' }

describe('We owe suppliers: the Pay link', () => {
  it('opens the Add expense dialog with the order, the supplier order and the amount owed, rounded to rupees', () => {
    const href = payHref(row, '2026-11-30')
    expect(href).not.toBeNull()
    const url = new URL(href!, 'https://x.test')
    expect(url.pathname).toBe('/money/expenses')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      add: '1',
      order: 'o-1',
      leg: 'l-1',
      amount: '384497',
      note: 'Owed (about) on 30 Nov, from We owe suppliers',
    })
  })

  it('leaves the amount out when nothing is owed in PKR yet', () => {
    const url = new URL(payHref({ ...row, owedPkr: null }, '2026-11-30')!, 'https://x.test')
    expect(url.searchParams.get('amount')).toBeNull()
    expect(url.searchParams.get('leg')).toBe('l-1')
  })

  it('shows no Pay for a settled, unpriced or rate-less row, or one without its order', () => {
    expect(payHref({ ...row, state: 'settled' }, '2026-11-30')).toBeNull()
    expect(payHref({ ...row, state: 'unpriced' }, '2026-11-30')).toBeNull()
    expect(payHref({ ...row, state: 'no_rate' }, '2026-11-30')).toBeNull()
    expect(payHref({ ...row, orderId: null }, '2026-11-30')).toBeNull()
  })
})
