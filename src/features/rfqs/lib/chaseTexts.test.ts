import { describe, expect, it } from 'vitest'
import { generateCustomerChase, customerConfirmBy, isBidClose, type CustomerChaseInput } from './customerChase'
import { generateGoodsChase, type GoodsChaseInput } from './goodsChase'
import { generatePaymentReminder, type PaymentReminderInput } from './paymentReminder'
import { generateSupplierChase, type SupplierChaseInput } from './supplierChase'
import { chaseClipboardText, FIRM_AFTER_DAYS } from './chaseCommon'
import { agoWhen, chasedByText } from './collision'
import { addBusinessDays, businessDaysBetween, subtractBusinessDays, nextMonday } from './dateText'

// 2026-11-27 is a Friday.
const sig = { name: 'Ayesha Rana', company: 'Q-Tech Solutions' }

describe('business-day helpers', () => {
  it('step over weekends', () => {
    expect(addBusinessDays('2026-11-27', 1)).toBe('2026-11-30') // Fri -> Mon
    expect(addBusinessDays('2026-11-25', 3)).toBe('2026-11-30') // Wed -> Mon
    expect(addBusinessDays('2026-11-28', 1)).toBe('2026-11-30') // Sat -> Mon
    expect(addBusinessDays('2026-11-27', 0)).toBe('2026-11-27')
    expect(subtractBusinessDays('2026-12-01', 1)).toBe('2026-11-30')
    expect(subtractBusinessDays('2026-11-30', 1)).toBe('2026-11-27')
  })
  it('count working days elapsed', () => {
    expect(businessDaysBetween('2026-11-25', '2026-11-30')).toBe(3)
    expect(businessDaysBetween('2026-11-27', '2026-11-28')).toBe(0)
    expect(businessDaysBetween('2026-11-30', '2026-11-27')).toBe(0)
  })
  it('finds the next Monday strictly after a day', () => {
    expect(nextMonday('2026-11-27')).toBe('2026-11-30')
    expect(nextMonday('2026-11-30')).toBe('2026-12-07')
  })
})

describe('customer clarification chase', () => {
  const base: CustomerChaseInput = {
    rfqRef: 'RFQ-0177',
    customerRef: '74037',
    contactName: 'Mr. Tariq',
    questions: ['Line size and flange rating on the process line (item 2)', 'Fluid temperature range, and whether the meter sees CIP cleaning (items 2 and 3)'],
    askCount: 1,
    firstAskedOn: '2026-11-21',
    lastAskedOn: '2026-11-21',
    dueOn: '2026-12-11',
    today: '2026-11-27',
    signature: sig,
    variant: 'whatsapp',
  }

  it('confirm-by is one working day before the bid, three working days from today with none, never before today', () => {
    expect(customerConfirmBy('2026-12-01', '2026-11-27')).toBe('2026-11-30')
    expect(customerConfirmBy(null, '2026-11-27')).toBe('2026-12-02')
    expect(customerConfirmBy('2026-11-27', '2026-11-27')).toBe('2026-11-27')
    expect(customerConfirmBy('2026-11-20', '2026-11-27')).toBe('2026-11-27')
  })

  it('a bid within three working days is "close"', () => {
    expect(isBidClose('2026-12-01', '2026-11-27')).toBe(true)
    expect(isBidClose('2026-12-02', '2026-11-27')).toBe(true)
    expect(isBidClose('2026-12-03', '2026-11-27')).toBe(false) // four working days away
    expect(isBidClose('2026-11-27', '2026-11-27')).toBe(true) // due today
    expect(isBidClose('2026-11-26', '2026-11-27')).toBe(false)
    expect(isBidClose(null, '2026-11-27')).toBe(false)
  })

  it('writes the gentle WhatsApp reminder as approved, numbering every open question', () => {
    const t = generateCustomerChase({ ...base, dueOn: '2026-12-01' })
    expect(t.kind).toBe('bid_close') // 1 Dec is within three working days of Fri 27 Nov
    const g = generateCustomerChase(base)
    expect(g.kind).toBe('gentle')
    expect(g.subject).toBeNull()
    expect(g.confirmBy).toBe('2026-12-10')
    expect(g.body).toBe(
      [
        'Assalam o Alaikum Mr. Tariq,',
        '',
        'A gentle reminder about your RFQ *#74037*. To complete our quotation we still need your confirmation on:',
        '1. Line size and flange rating on the process line (item 2)',
        '2. Fluid temperature range, and whether the meter sees CIP cleaning (items 2 and 3)',
        '',
        'Kindly confirm by *Thursday 10 December*; our bid is due on Friday 11 December.',
        '',
        'Thank you for your support.',
        'Regards,',
        'Ayesha Rana',
        'Q-Tech Solutions',
      ].join('\n'),
    )
  })

  it('names the bid date when the bid is close', () => {
    const t = generateCustomerChase({ ...base, dueOn: '2026-11-30' })
    expect(t.kind).toBe('bid_close')
    expect(t.body).toContain('Our bid for your RFQ *#74037* is due *Monday 30 November*.')
    expect(t.body).toContain('Kindly confirm by *5:00 pm today*.')
    const tomorrow = generateCustomerChase({ ...base, dueOn: '2026-11-28', today: '2026-11-27' })
    expect(tomorrow.body).toContain('is due *tomorrow, Saturday 28 November*')
  })

  it('names the bid time and tags each question with its item when the data is there', () => {
    const t = generateCustomerChase({ ...base, dueOn: '2026-11-28', dueTime: '12:00:00', itemTags: [{ number: 2, label: 'Endress+Hauser Proline Promag 400' }, null] })
    expect(t.body).toContain('is due *tomorrow, Saturday 28 November, 12:00*.')
    expect(t.body).toContain('1. Line size and flange rating on the process line (item 2)')
    const e = generateCustomerChase({ ...base, variant: 'email', itemTags: [{ number: 2, label: 'Endress+Hauser Proline Promag 400' }, null] })
    expect(e.body).toContain('(item 2, Endress+Hauser Proline Promag 400)')
  })
  it('the email signature carries the job title and phone', () => {
    const e = generateCustomerChase({ ...base, variant: 'email', signature: { ...sig, jobTitle: 'Sales', phone: '+92 300 555 0188' } })
    expect(e.body.endsWith(['With best regards,', 'Ayesha Rana', 'Sales, Q-Tech Solutions', '+92 300 555 0188'].join(String.fromCharCode(10)))).toBe(true)
  })
  it('the third ask offers a way out and gives the dates of the earlier messages', () => {
    const t = generateCustomerChase({ ...base, askCount: 2, lastAskedOn: '2026-11-25', dueOn: '2026-12-11' })
    expect(t.kind).toBe('third')
    expect(t.body).toContain('We are writing once more about your RFQ *#74037*. The points below are still open from our messages of 21 and 25 November:')
    expect(t.body).toContain('If these items are no longer required, please let us know and we will close the enquiry. Otherwise, kindly confirm by *Thursday 10 December*.')
  })

  it('the very first ask is not a reminder', () => {
    const t = generateCustomerChase({ ...base, askCount: 0, firstAskedOn: null, lastAskedOn: null })
    expect(t.kind).toBe('first')
    expect(t.body).toContain('To complete our quotation for your RFQ *#74037* we need your confirmation on:')
    expect(t.body).not.toContain('reminder')
  })

  it('turns firmer once the first ask is more than 30 days old, and not before', () => {
    const at30 = generateCustomerChase({ ...base, askCount: 1, firstAskedOn: '2026-10-28', dueOn: null }) // 30 days
    expect(at30.kind).toBe('gentle')
    const at31 = generateCustomerChase({ ...base, askCount: 1, firstAskedOn: '2026-10-27', dueOn: null }) // 31 days
    expect(FIRM_AFTER_DAYS).toBe(30)
    expect(at31.kind).toBe('firm')
    expect(at31.body).toContain('It is now over a month since we first asked')
    expect(at31.body).toContain('Without your reply by *Wednesday 2 December* we will close the enquiry.')
  })

  it('never invents a question: no open questions, no numbered lines', () => {
    const t = generateCustomerChase({ ...base, questions: [] })
    expect(t.body).not.toMatch(/^\d\. /m)
  })

  it('without a customer reference it names ours', () => {
    const t = generateCustomerChase({ ...base, customerRef: null })
    expect(t.body).toContain('your enquiry (our ref *RFQ-0177*)')
    expect(generateCustomerChase({ ...base, customerRef: '#74037' }).body).toContain('*#74037*')
  })

  it('writes the email with a subject, the context and an offer to talk', () => {
    const t = generateCustomerChase({ ...base, variant: 'email', signature: { ...sig, jobTitle: 'Sales' } })
    expect(t.subject).toBe('RFQ #74037: your confirmation needed by Thursday 10 December')
    expect(t.body).toContain('Dear Mr. Tariq,\nAssalam o Alaikum.')
    expect(t.body).toContain('further to our message of Saturday 21 November')
    expect(t.body).toContain('If it is easier to discuss these over a call')
    expect(t.body.endsWith('With best regards,\nAyesha Rana\nSales, Q-Tech Solutions')).toBe(true)
    expect(t.body).not.toContain('*')
    expect(chaseClipboardText(t).startsWith('Subject: RFQ #74037')).toBe(true)
  })

  it('has a plain greeting without a contact', () => {
    expect(generateCustomerChase({ ...base, contactName: null }).body.startsWith('Assalam o Alaikum,\n')).toBe(true)
    expect(generateCustomerChase({ ...base, contactName: null, variant: 'email' }).body.startsWith('Dear Sir or Madam,')).toBe(true)
  })
})

describe('supplier quote chase (R07 text, now with the firmer wording)', () => {
  const base: SupplierChaseInput = {
    rfqRef: 'RFQ-0179',
    sentOn: '2026-11-23',
    dueOn: '2026-12-03',
    today: '2026-11-27',
    chaseCount: 0,
    contactName: 'Mr. Imran',
    pricedNumbers: [1],
    items: [{ number: 2, description: 'Yokogawa EJA530E pressure transmitter, 0-1 MPa', qty: 3, unit: 'nos' }],
    signature: sig,
    variant: 'whatsapp',
  }
  it('is unchanged when no age is given or the enquiry is 30 days old or less', () => {
    const plain = generateSupplierChase(base).body
    expect(generateSupplierChase({ ...base, ageDays: 30 }).body).toBe(plain)
    expect(plain).toContain('We are still awaiting your price for:')
  })
  it('is firmer after 30 days, in both variants', () => {
    const w = generateSupplierChase({ ...base, ageDays: 31 })
    expect(w.body).toContain('It is now over a month since our enquiry of *Monday 23 November* (ref *RFQ-0179*)')
    expect(w.body).toContain('Without a reply we will take it that you cannot offer them and move on.')
    const e = generateSupplierChase({ ...base, ageDays: 45, variant: 'email' })
    expect(e.body).toContain('It is now more than a month since our enquiry of Monday 23 November')
    expect(e.body).toContain('approach other sources')
    expect(e.subject).toContain('RFQ-0179')
  })
})

describe('supplier goods chase', () => {
  const base: GoodsChaseInput = {
    reference: 'PO 253102',
    placedOn: '2026-11-02',
    expectedOn: '2026-11-22',
    today: '2026-11-27',
    chaseCount: 0,
    contactName: 'Mr. Imran',
    items: [
      { description: 'Yokogawa EJA530E pressure transmitter, 0-1 MPa', qty: 3, unit: 'nos' },
      { description: 'Cerabar PMC71', brandName: 'Endress+Hauser', qty: 2, unit: null },
    ],
    signature: sig,
    variant: 'whatsapp',
  }

  it('includes the supplier_orders reference when set (A3)', () => {
    const t = generateGoodsChase(base)
    expect(t.body).toContain('our order *PO 253102* of Monday 2 November')
    expect(t.daysLate).toBe(5)
    expect(t.body).toBe(
      [
        'Assalam o Alaikum Mr. Imran,',
        '',
        'Following up on our order *PO 253102* of Monday 2 November. It was due on *Sunday 22 November* and the goods have not yet been delivered:',
        '1. Yokogawa EJA530E pressure transmitter, 0-1 MPa, 3 nos',
        '2. Endress+Hauser Cerabar PMC71, 2 nos',
        '',
        'Could you please confirm the dispatch date by *Tuesday 1 December*?',
        '',
        'Thank you.',
        'Regards,',
        'Ayesha Rana',
        'Q-Tech Solutions',
      ].join('\n'),
    )
  })

  it('falls back to the order date when no reference is set, and says "our order" with neither', () => {
    expect(generateGoodsChase({ ...base, reference: null }).body).toContain('our order of *Monday 2 November*')
    expect(generateGoodsChase({ ...base, reference: null, placedOn: null }).body).toContain('Following up on our order.')
  })

  it('the email carries the reference in the subject', () => {
    const t = generateGoodsChase({ ...base, variant: 'email' })
    expect(t.subject).toBe('Order PO 253102: delivery date needed by Tuesday 1 December')
    expect(t.body).toContain('We refer to our order PO 253102 of Monday 2 November.')
  })

  it('never names the customer or a price', () => {
    const t = generateGoodsChase(base)
    expect(t.body).not.toMatch(/customer|PKR|price/i)
  })

  it('a second chase asks for the date tomorrow; over a month late is firmer', () => {
    const second = generateGoodsChase({ ...base, chaseCount: 1 })
    expect(second.body).toContain('A further reminder on our order *PO 253102*')
    expect(second.confirmBy).toBe('2026-11-30')
    const firm = generateGoodsChase({ ...base, expectedOn: '2026-10-20' }) // 38 days late
    expect(firm.daysLate).toBe(38)
    expect(firm.body).toContain('It is now over a month since our order *PO 253102* of Monday 2 November was due.')
    expect(firm.body).toContain('Please confirm a firm dispatch date by *Monday 30 November*.')
    const notYet = generateGoodsChase({ ...base, expectedOn: '2026-10-28' }) // 30 days late
    expect(notYet.body).not.toContain('over a month')
  })

  it('lists nothing it was not given', () => {
    const t = generateGoodsChase({ ...base, items: [] })
    expect(t.body).not.toMatch(/^\d\. /m)
    expect(t.body).toContain('the goods have not yet been delivered.')
  })
})

describe('payment reminder', () => {
  const base: PaymentReminderInput = {
    invoiceNumber: 'INV-2256',
    invoiceDate: '2026-09-20',
    customerPo: '251992',
    balance: 1111600,
    settled: 800000,
    dueOn: '2026-10-20',
    today: '2026-11-27',
    reminderCount: 2,
    lastRemindedOn: '2026-11-14',
    contactName: 'Mr. Faisal',
    signature: sig,
    variant: 'whatsapp',
  }

  it('writes the firmer wording as mocked once more than 30 days overdue', () => {
    const t = generatePaymentReminder(base)
    expect(t.firm).toBe(true)
    expect(t.daysOverdue).toBe(38)
    expect(t.body).toBe(
      [
        'Assalamu alaikum Mr. Faisal,',
        '',
        'I hope you are well.',
        'Our records show that Sales Tax Invoice INV-2256 dated 20 September 2026 (your PO 251992) still has an outstanding balance of PKR 1,111,600 (after your payment of PKR 800,000). It was due on 20 October 2026 and is now 38 days overdue. We have reminded you twice, most recently on 14 November.',
        '',
        'We request you to treat this as a priority and confirm the payment date by return. If there is a query on the invoice, or a document you are waiting for from us, please tell us today so that we can resolve it at once.',
        '',
        'Thank you for your understanding.',
        '',
        'Regards,',
        'Ayesha Rana',
        'Q-Tech Solutions',
      ].join('\n'),
    )
  })

  it('is polite up to and including 30 days overdue', () => {
    const t = generatePaymentReminder({ ...base, dueOn: '2026-10-28', reminderCount: 0, lastRemindedOn: null, settled: 0 }) // 30 days
    expect(t.firm).toBe(false)
    expect(t.body).toContain('It fell due on 28 October 2026, 30 days ago.')
    expect(t.body).toContain('We would be grateful if you could confirm when payment will be made.')
    expect(t.body).not.toContain('reminded')
    expect(t.body).not.toContain('after your payment')
    expect(t.body).not.toContain('priority')
    const firm = generatePaymentReminder({ ...base, dueOn: '2026-10-27' }) // 31 days
    expect(firm.firm).toBe(true)
  })

  it('the email has a subject with the balance and the same two tones', () => {
    const t = generatePaymentReminder({ ...base, variant: 'email', signature: { ...sig, jobTitle: 'Sales' } })
    expect(t.subject).toBe('Invoice INV-2256: payment overdue, PKR 1,111,600 outstanding')
    expect(t.body).toContain('Dear Mr. Faisal,\nAssalamu alaikum.')
    expect(t.body.endsWith('With best regards,\nAyesha Rana\nSales, Q-Tech Solutions')).toBe(true)
    const polite = generatePaymentReminder({ ...base, variant: 'email', dueOn: '2026-11-10', reminderCount: 0, lastRemindedOn: null })
    expect(polite.subject).toBe('Invoice INV-2256: payment due, PKR 1,111,600 outstanding')
  })

  it('works for an order that is not invoiced yet', () => {
    const t = generatePaymentReminder({ ...base, invoiceNumber: null, invoiceDate: null, customerPo: null, settled: 0, reminderCount: 0, lastRemindedOn: null })
    expect(t.body).toContain('Our records show that our order still has an outstanding balance of PKR 1,111,600.')
  })

  it('keeps paisa when there are any', () => {
    expect(generatePaymentReminder({ ...base, balance: '1111600.50' }).body).toContain('PKR 1,111,600.50')
  })
})

describe('the collision line (O-3)', () => {
  // 2026-11-27 10:00 in Karachi
  const now = new Date('2026-11-27T10:00:00+05:00').getTime()
  it('says how long ago, down to the hour', () => {
    expect(agoWhen('2026-11-27T09:00:00+05:00', now)).toBe('1h ago')
    expect(agoWhen('2026-11-27T09:40:00+05:00', now)).toBe('20 min ago')
    expect(agoWhen('2026-11-27T09:59:00+05:00', now)).toBe('just now')
    expect(agoWhen('2026-11-26T18:00:00+05:00', now)).toBe('yesterday')
    expect(agoWhen('2026-11-24T10:00:00+05:00', now)).toBe('3 days ago')
  })
  it('says the day when only the day is known', () => {
    expect(agoWhen('2026-11-27', now)).toBe('today')
    expect(agoWhen('2026-11-26', now)).toBe('yesterday')
    expect(agoWhen('2026-11-20', now)).toBe('7 days ago')
  })
  it('names the colleague by first name', () => {
    expect(chasedByText('Ali Raza', '2026-11-27T09:00:00+05:00', now)).toBe('Ali chased this 1h ago')
  })
})
