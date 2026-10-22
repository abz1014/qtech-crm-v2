// Held-out enquiries: written after enquiryParse.ts was finished, in styles it had not been built for (roman-numeral markers,
// one cell per line, a quantity in Urdu words, space-aligned columns). Same rules as enquiryEmails.ts; every name and number
// is made up.
//
// The first, blind run (2026-10-20) is the honest guess at unseen text: new parser 13 of 19 items right (precision 59%,
// recall 68%), refs 2/3, due dates 3/3, companies 3/3; old parser precision 32%, recall 63%, no facts. The general gaps it
// showed were then fixed (roman markers, "Required Quantity", "- 2" after a part number, greeting sentences, header words on
// their own line, space-aligned columns, "Ref. No."), so these cases now pass and are no longer held out.
import type { EnquiryCase } from './enquiryEmails'

const i = (description: string, qty = 1, unit: string | null = null) => ({ description, qty, unit })

export const ENQUIRY_HOLDOUT: EnquiryCase[] = [
  {
    name: 'Excel table with a Remarks column, RFQ Ref and bid due date',
    text: `Dear Sir,

Please find below our requirement. RFQ Ref: SFL/RFQ/26/1043

S.No\tDescription\tQty\tUnit\tRemarks
1\tLevel switch vibrating fork, 24VDC\t2\tNos\tFor silo
2\tRotary paddle level switch 220VAC\t3\tNos\t

Bid due date: 04/11/2026

Kind Regards,
Shahid Iqbal
Silverlake Fibres Demo Ltd`,
    items: [i('Level switch vibrating fork, 24VDC', 2, 'nos'), i('Rotary paddle level switch 220VAC', 3, 'nos')],
    ref: 'SFL/RFQ/26/1043',
    due: '2026-11-04',
    company: { name: 'Silverlake Fibres Demo Ltd' },
  },
  {
    name: 'WhatsApp, Urdu quantity word and "bhej dein"',
    text: `Pressure gauge 0-10 bar 4 inch - 3 adad
2 pcs isolation valve 1/2 inch bhej dein`,
    items: [i('Pressure gauge 0-10 bar 4 inch', 3), i('isolation valve 1/2 inch', 2, 'nos')],
  },
  {
    name: 'Brand lines, Qty: 1 Set and a mobile number in the signature',
    text: `Dear Sir,
Please quote:
1. Gas analyzer O2 zirconia type
Brand: ABB / Yokogawa
Qty: 1 Set
2. Sample conditioning system for the above
Qty: 1 Set
Best Regards,
Kashif Raza
M: +92 300 1234567`,
    items: [i('Gas analyzer O2 zirconia type, Brand: ABB / Yokogawa', 1, 'set'), i('Sample conditioning system for the above', 1, 'set')],
  },
  {
    name: 'formal letter with roman-numeral items and a due date in the sentence',
    text: `Subject: Request for Quotation - Ref. No. AKS/MM/2026/77

We would appreciate your quotation for the following items by 15 November 2026:
(i) Variable speed drive 22 kW, 400 V - 1 No.
(ii) Line reactor for 22 kW drive - 1 No.

Yours sincerely,
Materials Manager
Al-Karam Steel Demo (Pvt) Ltd`,
    items: [i('Variable speed drive 22 kW, 400 V', 1, 'nos'), i('Line reactor for 22 kW drive', 1, 'nos')],
    ref: 'AKS/MM/2026/77',
    due: '2026-11-15',
    company: { name: 'Al-Karam Steel Demo (Pvt) Ltd' },
  },
  {
    name: 'columns separated by spaces (copied from a PDF viewer)',
    text: `Please quote
1   Ball valve 2" SS316 full bore   10   Nos
2   Check valve 1" brass   5   Nos`,
    items: [i('Ball valve 2" SS316 full bore', 10, 'nos'), i('Check valve 1" brass', 5, 'nos')],
  },
  {
    name: 'Required Quantity and Specs lines',
    text: `Hello,
Item: Thermal imaging camera
Specs: 320x240, -20 to 650C
Required Quantity: 1
Item: Infrared thermometer gun
Specs: -50 to 800C
Required Quantity: 4
Regards
Instrument Section`,
    items: [i('Thermal imaging camera, Specs: 320x240, -20 to 650C', 1), i('Infrared thermometer gun, Specs: -50 to 800C', 4)],
  },
  {
    name: 'part numbers with an en dash and a bare quantity',
    text: `Sir need rates
Siemens 6ES7 231-4HD32-0XB0 – 2
Siemens 6ES7 232-4HD32-0XB0 – 1`,
    items: [i('Siemens 6ES7 231-4HD32-0XB0', 2), i('Siemens 6ES7 232-4HD32-0XB0', 1)],
  },
  {
    name: 'a table pasted as one cell per line',
    text: `S.No
Description
Qty
1
Gate valve 6" class 150
4`,
    items: [i('Gate valve 6" class 150', 4)],
  },
  {
    name: 'a casual email with two items in one question',
    text: `Hi Ali, hope you are well. Can you send me prices for 10 x M12 cable glands and 5 x M20 cable glands? Need them by Friday.
Thanks,
Sara
Crescent Fibres Demo Ltd`,
    items: [i('M12 cable glands', 10), i('M20 cable glands', 5)],
    company: { name: 'Crescent Fibres Demo Ltd' },
  },
  {
    name: 'SAP lines without tabs and a "not later than" deadline',
    text: `Collective No. 6000008811
Your quotation should reach the undersigned not later than 12.11.2026.
00010 Bearing 6205-2RS C3 10.000 EA
00020 Oil seal 35x52x7 NBR 20.000 EA`,
    items: [i('Bearing 6205-2RS C3', 10, 'nos'), i('Oil seal 35x52x7 NBR', 20, 'nos')],
    ref: '6000008811',
    due: '2026-11-12',
  },
]
