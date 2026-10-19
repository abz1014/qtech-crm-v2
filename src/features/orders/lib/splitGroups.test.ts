import { describe, expect, it } from 'vitest'
import { groupItems, type Groupable } from '@/features/orders/lib/splitGroups'

const it_ = (id: string, rfqItemId: string | null, qty: number, price: number | null = 100, isService = false): Groupable => ({ id, rfqItemId, qty, unitPriceNet: price, isService })

describe('split groups', () => {
  it('lines with one RFQ item become a head and its parts, numbered 2, 2a, 2b', () => {
    const rows = groupItems([it_('a', 'r1', 2), it_('b', 'r2', 3), it_('c', 'r3', 2), it_('d', 'r2', 1)])
    expect(rows.map(r => `${r.kind}:${r.no}`)).toEqual(['row:1', 'head:2', 'part:2a', 'part:2b', 'row:3'])
    const head = rows[1]
    expect(head.kind === 'head' && head.qty).toBe(4)
    expect(rows[2].kind === 'part' && rows[2].item.id).toBe('b')
    expect(rows[3].kind === 'part' && rows[3].item.id).toBe('d')
  })
  it('one line per RFQ item is not a group; lines with no RFQ item never group', () => {
    expect(groupItems([it_('a', 'r1', 2), it_('b', null, 3), it_('c', null, 1)]).map(r => r.kind)).toEqual(['row', 'row', 'row'])
  })
  it('a service line never joins a group', () => {
    expect(groupItems([it_('a', 'r1', 2), it_('b', 'r1', 3, 100, true)]).map(r => r.kind)).toEqual(['row', 'row'])
  })
  it('the head carries one price, or "mixed" when the parts disagree', () => {
    const same = groupItems([it_('a', 'r1', 2, 50), it_('b', 'r1', 1, 50)])[0]
    expect(same.kind === 'head' && same.unitPriceNet).toBe(50)
    const mixed = groupItems([it_('a', 'r1', 2, 50), it_('b', 'r1', 1, 60)])[0]
    expect(mixed.kind === 'head' && mixed.unitPriceNet).toBe('mixed')
  })
})
