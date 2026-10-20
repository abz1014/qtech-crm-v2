import { describe, expect, it } from 'vitest'
import type { InquiryRow, RfqItemRow } from '@/features/rfqs/api'
import { withShortlist } from '@/features/rfqs/askList'
import type { SupplierSuggestion } from '@/features/rfqs/lib'

const inq = (o: Partial<InquiryRow>) => ({ id: 'i', supplierId: 's', supplierName: 'S', sentOn: null, noOfferOn: null, lines: [], ...o }) as InquiryRow
const items = [{ id: 'it-1' }, { id: 'it-2' }] as RfqItemRow[]
const sug = (id: string, preTicked = false) => ({ supplierId: id, name: id, preTicked }) as SupplierSuggestion

describe('the Ask list on the RFQ page (review item 3)', () => {
  it('puts the shortlist (saved without asking) first and ticked, then the suggestions; the asked are not listed again', () => {
    const list = withShortlist(
      [inq({ id: 'a', supplierId: 's-short', supplierName: 'Orient' }), inq({ id: 'b', supplierId: 's-sent', sentOn: '2026-10-01' })],
      items,
      [sug('s-other'), sug('s-short', false)],
    )
    expect(list?.map(s => s.supplierId)).toEqual(['s-short', 's-other'])
    expect(list?.[0]).toMatchObject({ name: 'Orient', preTicked: true, reason: 'On the shortlist from New RFQ. Not asked yet.', coversItemIds: ['it-1', 'it-2'] })
  })

  it('waits for the suggestions to load', () => {
    expect(withShortlist([inq({})], items, undefined)).toBeUndefined()
  })
})
