// Whole emails and chat copies as the owner pastes them (owner test 2026-10-20: "pasting a whole email turns every line into an
// item"): greeting, an intro sentence, the items, a closing, a full signature (name, title, company, phones, address, website,
// disclaimer) and often the quoted thread below. Written as a held-out set BEFORE the parser was tuned for them; the blind result
// is recorded in docs/DECISIONS.md. Every company, person, number and domain is made up.
import type { EnquiryCase } from './enquiryEmails'

const i = (description: string, qty = 1, unit: string | null = null) => ({ description, qty, unit })

export const ENQUIRY_FULL_EMAILS: EnquiryCase[] = [
  {
    name: 'Outlook: numbered list, full signature, disclaimer and the quoted thread',
    text: `Dear Mr. Hamza,

Good day. Please send your best quotation for the following items at the earliest.

1. Pressure transmitter 0-25 bar, 4-20mA, 1/2" NPT - 3 Nos
2. Temperature gauge 0-150 C, 4" dial, bottom entry - 6 Nos
3. Solenoid valve 1/2" 24VDC normally closed - 2 Nos

Our enquiry ref: NRL/ENQ/2026/772. Quotation due: 30/10/2026.

Thanks & Regards,

Faraz Siddiqui
Assistant Manager Procurement
Northfield Refinery Demo Ltd.
Plot 22, Korangi Industrial Area, Karachi
Tel: +92 21 3555 0101 Ext 214 | Cell: 0333-5550101
www.northfield-demo.pk

DISCLAIMER: This email and any attachments are confidential and intended solely for the addressee.

From: Hamza Ali <hamza@qtech-solutions.pk>
Sent: Monday, October 19, 2026 10:12 AM
To: Faraz Siddiqui <faraz.s@northfield-demo.pk>
Subject: RE: Requirement of instruments

Dear Faraz, please share the list and we will quote.`,
    items: [i('Pressure transmitter 0-25 bar, 4-20mA, 1/2" NPT', 3, 'nos'), i('Temperature gauge 0-150 C, 4" dial, bottom entry', 6, 'nos'), i('Solenoid valve 1/2" 24VDC normally closed', 2, 'nos')],
    ref: 'NRL/ENQ/2026/772',
    due: '2026-10-30',
    company: { name: 'Northfield Refinery Demo Ltd.' },
  },
  {
    name: 'Gmail: items in a sentence, "On ... wrote:" thread with > lines',
    text: `Hi,

Please quote 2 nos pressure transmitter 0-10 bar and 4 nos pressure gauge 0-16 bar 4 inch dial.

Thanks
Adeel

On Mon, Oct 19, 2026 at 9:41 AM Q-Tech Sales <sales@qtech-solutions.pk> wrote:
> Dear Adeel,
> Thank you for your call. Please send the requirement.
> Regards`,
    items: [i('pressure transmitter 0-10 bar', 2, 'nos'), i('pressure gauge 0-16 bar 4 inch dial', 4, 'nos')],
  },
  {
    name: 'WhatsApp export lines with dates first, a greeting message and thanks',
    text: `19/10/2026, 11:02 - Imran Bashir: Salam
19/10/2026, 11:03 - Imran Bashir: Need rates for
19/10/2026, 11:03 - Imran Bashir: Flow switch paddle type 1 inch - 2 nos
19/10/2026, 11:04 - Imran Bashir: Level transmitter radar 0-6 m - 1 no
19/10/2026, 11:05 - Imran Bashir: Thanks`,
    items: [i('Flow switch paddle type 1 inch', 2, 'nos'), i('Level transmitter radar 0-6 m', 1, 'nos')],
  },
  {
    name: 'Table pasted from Excel inside an email, with a signature block',
    text: `Dear Sir,

Kindly quote the following material:

Item\tDescription\tQty\tUOM
1\tThermocouple K type 300 mm, SS sheath\t10\tNos
2\tRTD PT100 3 wire 150 mm\t8\tNos
3\tCompensating cable K type\t200\tm

Regards,
Hina Tariq
Purchase Officer
Crescent Glassworks Demo (Pvt) Ltd
Ph: 042-35550123`,
    items: [i('Thermocouple K type 300 mm, SS sheath', 10, 'nos'), i('RTD PT100 3 wire 150 mm', 8, 'nos'), i('Compensating cable K type', 200, 'm')],
    company: { name: 'Crescent Glassworks Demo (Pvt) Ltd' },
  },
  {
    name: 'Word table pasted with pipes, RFQ number in the subject line',
    text: `Subject: RFQ No. CGP-4471 - Electrical items

Dear Supplier,

We invite your quotation for:

| S.No | Item | Qty | Unit |
| 1 | MCCB 3 pole 250A 36kA | 2 | Nos |
| 2 | Contactor 32A 220VAC coil | 6 | Nos |

Last date for submission: 05-11-2026

Best regards
Procurement Section
Chenab Grid Demo Company`,
    items: [i('MCCB 3 pole 250A 36kA', 2, 'nos'), i('Contactor 32A 220VAC coil', 6, 'nos')],
    ref: 'CGP-4471',
    due: '2026-11-05',
  },
  {
    name: 'Short email with one item and "Sent from my iPhone"',
    text: `Dear Sir
Please send price and delivery for Siemens S7-1200 CPU 1214C DC/DC/DC qty 1.
Regards
Waqas

Sent from my iPhone`,
    items: [i('Siemens S7-1200 CPU 1214C DC/DC/DC', 1)],
  },
  {
    name: 'Bulleted list with Make lines and a long signature with website and fax',
    text: `Hello Team,

Hope you are doing well. We need the following urgently:

- Proximity sensor M18 PNP NO 8mm - 12 pcs
  Make: Pepperl+Fuchs or equivalent
- Photoelectric sensor diffuse 24VDC - 4 pcs
  Make: Sick

Please mention delivery time and validity in your offer.

Best Regards,
Sana Javed
Maintenance Planner
Indus Packaging Demo Ltd.
Fax: 021-35559988
Web: www.induspack-demo.com`,
    items: [i('Proximity sensor M18 PNP NO 8mm, Make: Pepperl+Fuchs or equivalent', 12, 'nos'), i('Photoelectric sensor diffuse 24VDC, Make: Sick', 4, 'nos')],
    company: { name: 'Indus Packaging Demo Ltd.' },
  },
  {
    name: 'Forwarded message: our colleague forwards the customer email',
    text: `---------- Forwarded message ---------
From: Kashif Mehmood <kashif@ravisugar-demo.pk>
Date: Tue, Oct 20, 2026 at 8:15 AM
Subject: Enquiry for VFD
To: <sales@qtech-solutions.pk>

Dear Sir,

Please quote VFD 7.5 kW 400V 3 phase - 2 Nos and VFD 15 kW 400V 3 phase - 1 No.

Regards
Kashif Mehmood
Electrical Engineer
Ravi Sugar Demo Mills Ltd`,
    items: [i('VFD 7.5 kW 400V 3 phase', 2, 'nos'), i('VFD 15 kW 400V 3 phase', 1, 'nos')],
    company: { name: 'Ravi Sugar Demo Mills Ltd' },
  },
  {
    name: 'Item blocks: Item 1 / Description / Qty Required',
    text: `Dear Vendor,

Please submit your quotation as per the details below.

Item 1
Description: Control valve 2" globe type, pneumatic actuator, Class 300
Qty Required: 01 No

Item 2
Description: Valve positioner smart HART 4-20mA
Qty Required: 02 Nos

Quotation must reach us before 12th November 2026.

Regards,
Supply Chain Department
Margalla Chemicals Demo Ltd`,
    items: [i('Control valve 2" globe type, pneumatic actuator, Class 300', 1, 'nos'), i('Valve positioner smart HART 4-20mA', 2, 'nos')],
    due: '2026-11-12',
    company: { name: 'Margalla Chemicals Demo Ltd' },
  },
  {
    name: 'Reply on top of our own quotation thread (Outlook headers in the quoted part)',
    text: `Dear Hamza,

Please also quote for Pressure switch 0-10 bar adjustable - 3 Nos.

Regards,
Bilal

________________________________
From: Hamza Ali
Sent: 18 October 2026 16:20
To: Bilal Khan
Subject: Quotation QT-2026-0912

Dear Bilal, please find our quotation attached.
1. Pressure gauge 0-10 bar - 5 Nos - PKR 4,500 each`,
    items: [i('Pressure switch 0-10 bar adjustable', 3, 'nos')],
  },
  {
    name: 'Urdu-English chat paste with items and a polite closing',
    text: `AoA bhai
2 nos level switch float type chahiye
1 no junction box SS 6 way bhi
jaldi rate bata dein
shukriya`,
    items: [i('level switch float type', 2, 'nos'), i('junction box SS 6 way', 1, 'nos')],
  },
  {
    name: 'Tender style: Tender No, closing date, items numbered with brackets',
    text: `TENDER NOTICE
Tender No: KWB-T-118/2026
Closing date: 15/11/2026

The following items are required:
1) Electromagnetic flow meter DN150, PN16 - 2 Nos
2) Electromagnetic flow meter DN200, PN16 - 1 No

Bidders must quote validity of 90 days.

Procurement Officer
Karachi Water Board Demo`,
    items: [i('Electromagnetic flow meter DN150, PN16', 2, 'nos'), i('Electromagnetic flow meter DN200, PN16', 1, 'nos')],
    ref: 'KWB-T-118/2026',
    due: '2026-11-15',
  },
  {
    name: 'Email whose signature has a mobile, landline and address on separate lines, no sign-off word',
    text: `Dear Sir,
Please quote Gas detector H2S fixed type 0-100 ppm - 4 Nos.

Asim Raza
HSE Engineer
Lucky Fertilizer Demo Ltd
Mob: 0300-5551234
Off: 091-5550001
Hayatabad Industrial Estate, Peshawar`,
    items: [i('Gas detector H2S fixed type 0-100 ppm', 4, 'nos')],
    company: { name: 'Lucky Fertilizer Demo Ltd' },
  },
  {
    name: 'Space-aligned columns copied from a PDF viewer into an email',
    text: `Dear Sir,

Requirement as under:

S.No    Description                         Qty    Unit
1       Cable gland 3/4" brass              50     Nos
2       Cable tray 300 mm perforated        20     Lengths

Regards
Store Incharge`,
    items: [i('Cable gland 3/4" brass', 50, 'nos'), i('Cable tray 300 mm perforated', 20, 'lengths')],
  },
  {
    name: 'Gmail with an intro paragraph, items with Qty: labels and quoted earlier message',
    text: `Hello Mr. Ali,

Further to our telephone conversation today, please quote the items below on your letterhead, with delivery period and payment terms.

Ultrasonic flow meter clamp-on, DN50-DN300, Qty: 1 No
Spare transducers for the above, Qty: 1 Set

Best regards,
Nadia Hussain
Senior Engineer Instrumentation
Fauji Demo Power Company Ltd
nadia.hussain@faujipower-demo.pk

On Sat, 17 Oct 2026, 14:03 Ali Raza, <ali@qtech-solutions.pk> wrote:
> Noted, will revert.`,
    items: [i('Ultrasonic flow meter clamp-on, DN50-DN300', 1, 'nos'), i('Spare transducers for the above', 1, 'sets')],
    company: { domain: 'faujipower-demo.pk' },
  },
  {
    name: 'Very short WhatsApp line, an item in a sentence with x quantity',
    text: `Rate chahiye: Allen Bradley PowerFlex 525 2.2kW x 2`,
    items: [i('Allen Bradley PowerFlex 525 2.2kW', 2)],
  },
]
