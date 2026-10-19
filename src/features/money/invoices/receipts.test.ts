import { afterEach, describe, expect, it } from 'vitest'
import { listReceipts, psidKey, uploadReceipt } from '@/features/money/invoices/api'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { requireSupabase, setSupabaseForTests, type Db } from '@/lib/supabase'

/*
 * One FBR deposit has one PSID and one receipt, however many invoices it pays (audit T1). The receipt step is dated on every invoice
 * of the PSID group by one upload, so the "FBR: N need attention" item on Today clears for the whole group.
 */
function setup(respond: (c: FakeCall) => { data?: unknown } = () => ({ data: [] })) {
  const fake = installFakeDb(respond)
  const base = requireSupabase()
  const uploaded: string[] = []
  setSupabaseForTests({
    ...base,
    storage: { from: () => ({ upload: async (path: string) => (uploaded.push(path), { error: null }), remove: async () => ({ error: null }) }) },
  } as unknown as Db)
  return { fake, uploaded }
}

afterEach(() => installFakeDb(() => ({})).uninstall())

const FILE = new File([new Uint8Array([1, 2, 3])], 'receipt.png', { type: 'image/png' })
const stamps = (calls: FakeCall[]) => calls.filter(c => c.target === 'invoices' && c.verb === 'update')

describe('a receipt covers every invoice of its PSID', () => {
  it('with a PSID, one upload dates the receipt step on all invoices of that PSID that have none', async () => {
    const { fake } = setup()
    await uploadReceipt('inv-1', FILE, '2026-11-20', ' P-778 ')
    const [group, own] = stamps(fake.calls)
    expect(opArgs(group, 'update')?.[0]).toEqual({ wasif_receipt_on: '2026-11-20' })
    expect(group.ops.some(([n, a]) => n === 'eq' && a[0] === 'psid' && a[1] === 'P-778')).toBe(true)
    expect(group.ops.some(([n, a]) => n === 'is' && a[0] === 'wasif_receipt_on' && a[1] === null)).toBe(true)
    // the invoice the file hangs on is stamped too, whatever PSID the open form shows
    expect(own.ops.some(([n, a]) => n === 'eq' && a[0] === 'id' && a[1] === 'inv-1')).toBe(true)
    // the file is recorded once, on the invoice it was uploaded from
    const rows = fake.calls.filter(c => c.target === 'attachments' && c.verb === 'insert')
    expect(rows).toHaveLength(1)
    expect(opArgs(rows[0], 'insert')?.[0]).toMatchObject({ invoice_id: 'inv-1', bucket: 'gst-receipts' })
  })

  it('without a PSID only that invoice is stamped', async () => {
    const { fake } = setup()
    await uploadReceipt('inv-1', FILE, '2026-11-20', null)
    const s = stamps(fake.calls)
    expect(s).toHaveLength(1)
    expect(s[0].ops.some(([n, a]) => n === 'eq' && a[0] === 'id' && a[1] === 'inv-1')).toBe(true)
    expect(s[0].ops.some(([n, a]) => n === 'eq' && a[0] === 'psid')).toBe(false)
  })

  it('lists the receipts of every invoice with the same PSID on each of them', async () => {
    const { fake } = setup(c =>
      c.target === 'invoices'
        ? { data: [{ id: 'inv-1' }, { id: 'inv-2' }, { id: 'inv-3' }] }
        : { data: [{ id: 'a1', invoice_id: 'inv-2', path: 'inv-2/x.png', file_name: 'x.png', size_bytes: 3 }] },
    )
    const list = await listReceipts('inv-1', 'P-778')
    expect(list).toEqual([{ id: 'a1', invoiceId: 'inv-2', path: 'inv-2/x.png', fileName: 'x.png', sizeBytes: 3 }])
    const q = fake.calls.find(c => c.target === 'attachments')!
    expect(opArgs(q, 'in')).toEqual(['invoice_id', ['inv-1', 'inv-2', 'inv-3']])
  })

  it('an empty or blank PSID is no group', () => {
    expect(psidKey('  ')).toBeNull()
    expect(psidKey(null)).toBeNull()
    expect(psidKey(' P-1 ')).toBe('P-1')
  })
})
