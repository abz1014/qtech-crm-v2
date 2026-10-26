import { afterEach, describe, expect, it } from 'vitest'
import { uploadAttachment } from '@/features/rfqs/api'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { requireSupabase, setSupabaseForTests, type Db } from '@/lib/supabase'

/* Migration 0100: an engineer reads no attachment tagged has_prices. The tag must reach the insert, or every upload gets the column default. */
function setup() {
  const fake = installFakeDb((c: FakeCall) => (c.target === 'attachments' ? { data: { id: 'a-1', path: 'p', file_name: 'po.pdf', mime_type: 'application/pdf', size_bytes: 3, clarification_id: null, created_at: '2026-10-26T00:00:00Z', has_prices: true } } : { data: [] }))
  const base = requireSupabase()
  setSupabaseForTests({ ...base, storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) } } as unknown as Db)
  return fake
}

afterEach(() => installFakeDb(() => ({})).uninstall())

const FILE = new File([new Uint8Array([1, 2, 3])], 'po.pdf', { type: 'application/pdf' })
const inserted = (fake: ReturnType<typeof setup>) => opArgs(fake.calls.find(c => c.target === 'attachments' && c.verb === 'insert')!, 'insert')?.[0]

describe('uploadAttachment writes has_prices', () => {
  it('a priced file (customer PO, supplier quote) is inserted with has_prices true', async () => {
    const fake = setup()
    await uploadAttachment({ rfqId: 'r-1', clarificationId: null, file: FILE, path: 'r-1/x.pdf', hasPrices: true })
    expect(inserted(fake)).toMatchObject({ has_prices: true, rfq_id: 'r-1' })
  })

  it('a site photo is inserted with has_prices false, written explicitly', async () => {
    const fake = setup()
    await uploadAttachment({ orderId: 'o-1', clarificationId: null, file: FILE, path: 'o-1/x.pdf', hasPrices: false })
    expect(inserted(fake)).toHaveProperty('has_prices', false)
  })
})
