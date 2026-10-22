// Outlook copies of an enquiry whose items are a table with no header row (owner case 2026-10-20): "description<TAB>qty<TAB>EA",
// or the same columns lined up with spaces (Outlook plain text), with part numbers full of dashes and a "-01" line suffix that is
// part of the description, never a quantity. Written as a held-out set BEFORE tuning; the blind result is in docs/DECISIONS.md.
// Every company, person, number and domain is made up. The unit is the customer's own word from the unit column.
import type { EnquiryCase } from './enquiryEmails'

const i = (description: string, qty: number, unit: string | null) => ({ description, qty, unit })

const header = (subject: string) => `From: Ali Raza <ali.raza@examplemills.com>
Sent: Tuesday, October 13, 2026 5:01 PM
To: Sales <sales@qtech-solutions.pk>
Subject: ${subject}

Dear Sir,

We trust this message finds you well,

Please share the price and availability for the below mentioned parts.
`

const signature = `
Regards,

Ali Raza
Deputy Manager | Purchase
Mobile : +923001234567 | Ext. 1234
Example Mills Limited, Some Centre, 2nd Floor,
1-A Main Road, Lahore 54000, Pakistan
www.examplemills.com`

const ROWS: Array<[string, number, string]> = [
  ['CAPACITOR 220UF 400 V-01', 12, 'EA'],
  ['RELAY 24VDC 4 POLE FOR PANEL-01', 12, 'EA'],
  ['DIODE BRIDGE 35A 1000V-01', 6, 'EA'],
  ['FUSE 10A GLASS 5X20MM-01', 50, 'EA'],
  ['TIMER RELAY 0-60 SEC 220VAC-01', 4, 'EA'],
  ['TERMINAL BLOCK 4MM GREY-01', 100, 'EA'],
  ['PILOT LAMP LED 22MM GREEN-01', 20, 'EA'],
  ['POWER SUPPLY 24VDC 5A DIN RAIL-01', 2, 'EA'],
]

const PARTS: Array<[string, number, string]> = [
  ['MEMMORY CARD 6ES7954-8LM31-0AA0-01', 6, 'EA'],
  ['DIGITAL INPUT MODULE 6ES7521-1BL00-0AB0-01', 2, 'EA'],
  ['FRONT CONNECTOR 6ES7592-1AM00-0XB0-01', 4, 'EA'],
  ['CABLE PROFIBUS 6XV1830-0EH10', 100, 'MTR'],
  ['CONNECTOR SET M12 4-PIN', 3, 'set'],
]

const pad = (s: string, n: number) => s + ' '.repeat(Math.max(3, n - s.length))

export const ENQUIRY_EMAIL_TABLES: EnquiryCase[] = [
  {
    name: 'Outlook copy, tab-separated rows with no header, ref at the end of the subject',
    text: `${header('RFQ FOR THE ELECTRONICS ITEMS REQUIRED 735216')}
${ROWS.map(([d, q, u]) => `${d}\t${q}\t${u}`).join('\n')}
${signature}`,
    items: ROWS.map(([d, q, u]) => i(d, q, u)),
    ref: '735216',
    company: { name: 'Example Mills Limited' },
  },
  {
    name: 'Outlook plain text, the same rows lined up with spaces',
    text: `${header('RFQ FOR THE ELECTRONICS ITEMS REQUIRED 735216')}
${ROWS.map(([d, q, u]) => `${pad(d, 44)}${pad(String(q), 8)}${u}`).join('\n')}
${signature}`,
    items: ROWS.map(([d, q, u]) => i(d, q, u)),
    ref: '735216',
    company: { name: 'Example Mills Limited' },
  },
  {
    name: 'Outlook copy as it reaches the clipboard on Windows: CRLF, a trailing tab, no-break spaces',
    text: `${header('RFQ FOR THE ELECTRONICS ITEMS REQUIRED 735216')}
${ROWS.map(([d, q, u]) => `${d.replace(/ /g, ' ')}\t${q}\t${u}\t`).join('\r\n')}
${signature}`.replace(/\n/g, '\r\n').replace(/\r\r/g, '\r'),
    items: ROWS.map(([d, q, u]) => i(d, q, u)),
    ref: '735216',
    company: { name: 'Example Mills Limited' },
  },
  {
    name: 'The cells collapsed to single spaces by the mail client: "desc 12 EA"',
    text: `${header('RFQ FOR THE ELECTRONICS ITEMS REQUIRED 735216')}
${ROWS.map(([d, q, u]) => `${d} ${q} ${u}`).join('\n')}
${signature}`,
    items: ROWS.map(([d, q, u]) => i(d, q, u)),
    ref: '735216',
    company: { name: 'Example Mills Limited' },
  },
  {
    name: 'Part numbers full of dashes (shaded rows copied as tab rows), mixed units',
    text: `${header('RFQ PLC SPARES EML-RFQ-2210')}
${PARTS.map(([d, q, u]) => `${d}\t${q}\t${u}`).join('\n')}
${signature}`,
    items: PARTS.map(([d, q, u]) => i(d, q, u)),
    ref: 'EML-RFQ-2210',
    company: { name: 'Example Mills Limited' },
  },
  {
    name: 'Part numbers lined up with spaces, a blank line between rows',
    text: `${header('Enquiry 2210-B for PLC spares')}
${PARTS.map(([d, q, u]) => `${pad(d, 48)}${pad(String(q), 6)}${u}`).join('\n\n')}
${signature}`,
    items: PARTS.map(([d, q, u]) => i(d, q, u)),
    ref: '2210-B',
    company: { name: 'Example Mills Limited' },
  },
]
