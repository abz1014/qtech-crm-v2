import { describe, expect, it } from 'vitest'
import { generatePaymentReminder, type PaymentReminderInput } from './paymentReminder'

const base: PaymentReminderInput = {
  invoiceNumber: 'INV-1',
  invoiceDate: '2024-05-01',
  customerPo: null,
  balance: 1000 as never,
  settled: 0 as never,
  dueOn: '2024-06-03',
  today: '2026-06-30',
  reminderCount: 0,
  lastRemindedOn: null,
  contactName: null,
  signature: { name: 'A', jobTitle: null, company: 'Co', phone: null } as never,
  variant: 'email',
  gross: 1000 as never,
}
const TOO_BIG = /\b([3-9]\d|\d{3,}) days overdue\b/

describe('payment reminder wording', () => {
  for (const variant of ['email', 'whatsapp'] as const) {
    it(`past 30 days gives the date, never a day count (${variant})`, () => {
      const r = generatePaymentReminder({ ...base, variant })
      expect(r.body).not.toMatch(TOO_BIG)
      expect(r.body).not.toMatch(/\d+ days ago/)
      expect(r.body).toMatch(/It fell due on 3 June? 2024 and is still unpaid/)
    })
  }
  it('31 days is already a date', () => {
    const r = generatePaymentReminder({ ...base, dueOn: '2026-05-30', today: '2026-06-30' })
    expect(r.body).toContain('and is still unpaid')
  })
  it('5 days overdue still says 5 days', () => {
    const r = generatePaymentReminder({ ...base, dueOn: '2026-06-25', today: '2026-06-30' })
    expect(r.body).toContain('5 days ago')
    expect(r.body).toContain('Days overdue: 5')
  })
})
