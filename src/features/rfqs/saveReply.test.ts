import { afterEach, describe, expect, it } from 'vitest'
import { saveReply } from '@/features/rfqs/api'
import { installFakeDb, opArgs } from '@/test/fakeSupabase'

/*
 * Saving a reply writes weight and origin (0111) only for the items whose form held them. PostgREST refuses one bulk upsert whose
 * rows carry different keys ("All object keys must match"), so rows with and without them go in separate calls.
 */
afterEach(() => installFakeDb(() => ({})).uninstall())

const base = { inquiryId: 'q1', currency: 'EUR', leadTime: '8 weeks', inStock: null, removeItemIds: [] }

describe('saveReply: weight and origin', () => {
  it('sends rows of the same shape in one upsert', async () => {
    const db = installFakeDb(() => ({}))
    await saveReply({ ...base, prices: [{ itemId: 'a', unitPrice: 1 }, { itemId: 'b', unitPrice: 2 }] })
    const ups = db.calls.filter(c => c.ops.some(([n]) => n === 'upsert'))
    expect(ups).toHaveLength(1)
    expect((opArgs(ups[0], 'upsert') as unknown[][])[0]).toHaveLength(2)
  })

  it('splits rows with and without weight and origin, and writes the kg default', async () => {
    const db = installFakeDb(() => ({}))
    await saveReply({
      ...base,
      prices: [
        { itemId: 'a', unitPrice: 3610, weight: 4.5, weightUnit: 'kg', origin: 'Germany' },
        { itemId: 'b', unitPrice: 980 },
      ],
    })
    const rows = db.calls.filter(c => c.ops.some(([n]) => n === 'upsert')).map(c => (opArgs(c, 'upsert') as unknown[][])[0] as Record<string, unknown>[])
    expect(rows).toHaveLength(2)
    const withExtras = rows.find(r => 'weight' in r[0])!
    expect(withExtras[0]).toMatchObject({ rfq_item_id: 'a', weight: 4.5, weight_unit: 'kg', origin: 'Germany' })
    const without = rows.find(r => !('weight' in r[0]))!
    expect(Object.keys(without[0])).not.toContain('origin')
  })
})
