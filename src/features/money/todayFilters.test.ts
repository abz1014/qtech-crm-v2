import { describe, expect, it } from 'vitest'
import { tcsNotSent } from '@/features/money/invoices/model'
import { isPaidProvisional } from '@/features/money/margins/model'

// The two list filters Today's money items open (M08): the register's "Not sent by TCS" and Margins' "Paid, costs provisional".
describe('filters opened from Today', () => {
  it('Not sent by TCS: not started or only copy received', () => {
    expect(tcsNotSent({ courierState: 'not_started' })).toBe(true)
    expect(tcsNotSent({ courierState: 'copy_received' })).toBe(true)
    expect(tcsNotSent({ courierState: 'sent' })).toBe(false)
    expect(tcsNotSent({ courierState: 'delivered_to_client' })).toBe(false)
  })
  it('Paid, costs provisional: settled and provisional only', () => {
    expect(isPaidProvisional({ state: 'provisional', paymentState: 'settled' })).toBe(true)
    expect(isPaidProvisional({ state: 'provisional', paymentState: 'part' })).toBe(false)
    expect(isPaidProvisional({ state: 'final', paymentState: 'settled' })).toBe(false)
    expect(isPaidProvisional({ state: 'basis_unknown', paymentState: 'settled' })).toBe(false)
    expect(isPaidProvisional({ state: 'provisional' })).toBe(false)
  })
})
