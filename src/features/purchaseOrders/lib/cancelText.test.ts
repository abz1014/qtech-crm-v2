import { describe, expect, it } from 'vitest'
import { cancellationMessage, sentPoSentence, type SentPo } from '@/features/purchaseOrders/lib/cancelText'

const po: SentPo = { ref: 'PO-26-0017', supplierName: 'Alpenmark Controls', items: [{ description: 'Cerabar PMC51', qty: 3, unit: 'ea' }, { description: 'Cable set', qty: 8, unit: null }] }

describe('cancel text for a sent PO', () => {
  it('says which PO went to whom', () => {
    expect(sentPoSentence(po)).toBe("PO-26-0017 was sent to Alpenmark Controls. Tell them it's cancelled.")
  })
  it('names the PO and the items, asks politely, and carries no price', () => {
    const t = cancellationMessage(po, 'Q-Tech Solutions')
    expect(t).toContain('*PO-26-0017*')
    expect(t).toContain('1. Cerabar PMC51, 3 ea')
    expect(t).toContain('2. Cable set, 8')
    expect(t).toMatch(/ask you to cancel/)
    expect(t).not.toMatch(/PKR|USD|EUR|price/i)
    expect(t.endsWith('Q-Tech Solutions')).toBe(true)
  })
})
