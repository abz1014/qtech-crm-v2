import { afterEach, describe, expect, it } from 'vitest'
import { installFakeDb } from '@/test/fakeSupabase'
import { getLegPo } from '@/features/purchaseOrders/api'

let uninstall: (() => void) | undefined
afterEach(() => uninstall?.())

describe('purchase orders api: the leg PO', () => {
  it('getLegPo returns the latest revision and the first issue date that PO-YY-NNNN is made from', async () => {
    const db = installFakeDb(() => ({
      data: [
        { id: 'po-r1', number: 17, revision: 1, issued_on: '2027-01-05', currency: 'USD', total: 10, pdf_path: null },
        { id: 'po-r0', number: 17, revision: 0, issued_on: '2026-12-28', currency: 'USD', total: 12, pdf_path: 'x' },
      ],
    }))
    uninstall = db.uninstall
    const po = await getLegPo('leg1')
    expect(po).toMatchObject({ id: 'po-r1', revision: 1, issuedOn: '2027-01-05', firstIssuedOn: '2026-12-28' })
  })
})
