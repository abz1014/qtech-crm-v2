import { describe, expect, it } from 'vitest'
import { poChange } from '@/features/orders/lib/poChange'

const line = (id: string, qty: number, isService = false) => ({ id, description: `Item ${id}`, qty, isService })

describe('lines changed since PO', () => {
  it('no PO, no indicator', () => {
    expect(poChange(null, [line('a', 4)])).toBeNull()
  })
  it('the same lines and quantities: nothing changed', () => {
    expect(poChange([{ orderItemId: 'a', qty: 4 }], [line('a', 4), line('s', 1, true)])).toBeNull()
  })
  it('a split that moved a unit away: was 4, now 3', () => {
    expect(poChange([{ orderItemId: 'a', qty: 4 }], [line('a', 3)])?.notes).toEqual(['Item a was ×4, now ×3'])
  })
  it('a line moved onto the leg, and a line moved off it', () => {
    expect(poChange([{ orderItemId: 'a', qty: 4 }], [line('a', 4), line('b', 1)])?.notes).toEqual(['Item b was added, ×1'])
    expect(poChange([{ orderItemId: 'a', qty: 4 }, { orderItemId: 'b', qty: 1 }], [line('a', 4)])?.notes).toEqual(['A line on the PO is no longer on this leg'])
  })
})
