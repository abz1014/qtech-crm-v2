// Realistic enquiries as they arrive: whole emails with signatures, disclaimers and quoted replies, WhatsApp exports, SAP and
// tender printouts read from a PDF (tab rows, as pdfText.ts writes them) and spreadsheet pastes. Modelled on the styles in
// src/features/rfqs/lib/__fixtures__/enquiryCorpus.ts and the data-entry audit (docs/audit). Every company, person, number
// and address is made up. Used by enquiryParse.test.ts, which also compares the old parser (parsePaste) on the same texts.
//
// Expected descriptions keep everything the customer specified: a "Make:" or "Size:" line under an item is appended as
// ", Make: ...". Quantity and unit are separate. Units are as parseItems normalises them (nos, set, m, ...).

export interface ExpectedItem {
  description: string
  qty: number
  unit: string | null
}

export interface EnquiryCase {
  name: string
  text: string
  items: ExpectedItem[]
  ref?: string
  /** YYYY-MM-DD. */
  due?: string
  company?: { name?: string; domain?: string }
}

/** "Today" for every case (dates without a year are read against it). */
export const CORPUS_TODAY = '2026-10-20'

const i = (description: string, qty = 1, unit: string | null = null): ExpectedItem => ({ description, qty, unit })

export const ENQUIRY_EMAILS: EnquiryCase[] = [
  {
    name: 'corporate email: numbered items, our ref, due date, signature, disclaimer',
    text: `Dear Sir,

Please quote your best prices for the following items required at our Hattar plant.

Our Ref: NCL/PUR/2026/0418

1. Pressure transmitter 0-16 bar, 4-20mA, 1/2" NPT - 2 Nos
2. Pressure gauge 4" dial, 0-10 bar, glycerine filled - 6 Nos
3. Three valve manifold SS316 - 2 Nos

Quotation must reach us latest by 28/10/2026.

Regards,

Asad Mehmood
Senior Purchase Officer
Northern Cement Company Limited
Plot 14, Industrial Estate Hattar, District Haripur
Tel: +92 995 617 220  Ext 145
Cell: 0300-5551234
Email: asad.mehmood@northerncement.com.pk

DISCLAIMER: This e-mail and any files transmitted with it are confidential and intended solely for the use of the individual to whom they are addressed.`,
    items: [
      i('Pressure transmitter 0-16 bar, 4-20mA, 1/2" NPT', 2, 'nos'),
      i('Pressure gauge 4" dial, 0-10 bar, glycerine filled', 6, 'nos'),
      i('Three valve manifold SS316', 2, 'nos'),
    ],
    ref: 'NCL/PUR/2026/0418',
    due: '2026-10-28',
    company: { name: 'Northern Cement Company Limited', domain: 'northerncement.com.pk' },
  },
  {
    name: 'unnumbered email: signature lines must not become items',
    text: `Hi,

Kindly send your quotation for below:

Siemens S7-1200 CPU 1214C DC/DC/DC qty 1
Siemens SM1231 analog input module 8AI qty 2
Siemens KTP700 Basic HMI qty 1

Please mention delivery time and origin.

Thanks & Regards
Usman Tariq
Instrument Engineer
Indus Fibres Ltd.
Ph: 042-35761234
www.indusfibres.com.pk`,
    items: [
      i('Siemens S7-1200 CPU 1214C DC/DC/DC', 1),
      i('Siemens SM1231 analog input module 8AI', 2),
      i('Siemens KTP700 Basic HMI', 1),
    ],
    company: { name: 'Indus Fibres Ltd.', domain: 'indusfibres.com.pk' },
  },
  {
    name: 'item blocks: Description, Make and QTY REQUIRED lines',
    text: `Dear Vendor,

Please submit your quotation for the following material.

Inquiry Ref: RGW/ENQ/2291
Due Date: 05-11-2026

Item 1
Description: Solenoid valve 2/2 way, 1/2" BSP, 24VDC
Make: ASCO or equivalent
QTY REQUIRED: 02

Item 2
Description: Air filter regulator 1/2" with gauge
Make: Festo
QTY REQUIRED: 04

Regards
Procurement Section
Ravi Glass Works (Pvt) Ltd`,
    items: [
      i('Solenoid valve 2/2 way, 1/2" BSP, 24VDC, Make: ASCO or equivalent', 2),
      i('Air filter regulator 1/2" with gauge, Make: Festo', 4),
    ],
    ref: 'RGW/ENQ/2291',
    due: '2026-11-05',
    company: { name: 'Ravi Glass Works (Pvt) Ltd' },
  },
  {
    name: 'SAP RFQ printout read from a PDF: collective no, RFQ no, 3-decimal quantities, dd-MMM-yy deadline',
    text: `Margalla Sugar Mills Limited
Request for Quotation
Collective No.: 6000004512
RFQ No.: 4500012345
RFQ Date: 14.10.2026
Quotations must reach us before 11-NOV-26

Item\tMaterial\tDescription\tQuantity\tUnit\tDelivery Date
00010\t1000012345\tTRANSMITTER,PRESSURE;0-16BAR,4-20MA Make: Rosemount, Model: 3051TG\t2.000\tEA\t15.12.2026
00020\t1000067890\tGAUGE,PRESSURE;0-10BAR,4" DIAL\t6.000\tEA\t15.12.2026
00030\t1000099911\tVALVE,MANIFOLD;3 WAY,SS316\t2.000\tEA\t15.12.2026

Please quote on your letterhead with validity and delivery period.`,
    items: [
      i('TRANSMITTER,PRESSURE;0-16BAR,4-20MA Make: Rosemount, Model: 3051TG', 2, 'nos'),
      i('GAUGE,PRESSURE;0-10BAR,4" DIAL', 6, 'nos'),
      i('VALVE,MANIFOLD;3 WAY,SS316', 2, 'nos'),
    ],
    ref: '4500012345',
    due: '2026-11-11',
    company: { name: 'Margalla Sugar Mills Limited' },
  },
  {
    name: 'WhatsApp export (iPhone): prefixes, "aur" and a courtesy line',
    text: `[20/10/2026, 10:12:45 AM] Bilal Ahmed: Assalam o alaikum sir
[20/10/2026, 10:13:02 AM] Bilal Ahmed: Please quote 2 nos proximity sensor M18 PNP NO 8mm sensing
[20/10/2026, 10:13:30 AM] Bilal Ahmed: Aur 1 no limit switch Omron D4N-4120
[20/10/2026, 10:14:11 AM] Bilal Ahmed: urgent hai`,
    items: [i('proximity sensor M18 PNP NO 8mm sensing', 2, 'nos'), i('limit switch Omron D4N-4120', 1, 'nos')],
  },
  {
    name: 'WhatsApp export (Android): x2 quantities and a due date without a year',
    text: `20/10/26, 11:05 am - Kashif: Sir rate chahiye
20/10/26, 11:05 am - Kashif: Fluke 87V multimeter x2
20/10/26, 11:06 am - Kashif: Fluke 376 FC clamp meter x1
20/10/26, 11:06 am - Kashif: Due 22/10`,
    items: [i('Fluke 87V multimeter', 2), i('Fluke 376 FC clamp meter', 1)],
    due: '2026-10-22',
  },
  {
    name: 'reply on top of a quoted thread: only the new message has items; the ref is in the thread subject',
    text: `Dear Ali,

Further to our call, please also quote the following:

1) Cable gland M20 brass - 20 Nos
2) Cable lugs 16mm2 - 100 Nos

Best regards,
Hamza

-----Original Message-----
From: Ali Raza <ali@qtech.example>
Sent: Monday, October 19, 2026 4:10 PM
To: Hamza Iqbal <hamza.iqbal@crescentsteel.com.pk>
Subject: RE: RFQ-CS-7781 Panel accessories

Dear Hamza,
Please find attached our quotation QT-0331 for
1) MCB 2 pole 16A - 10 Nos`,
    items: [i('Cable gland M20 brass', 20, 'nos'), i('Cable lugs 16mm2', 100, 'nos')],
    ref: 'RFQ-CS-7781',
    company: { domain: 'crescentsteel.com.pk' },
  },
  {
    name: 'forwarded enquiry: the items are below the forward line',
    text: `Please see below enquiry and arrange quotation.

---------- Forwarded message ---------
From: Procurement <procurement@karakoramgases.com.pk>
Date: Tue, 20 Oct 2026 at 09:41
Subject: Enquiry No. KGL-ENQ-55120 - Gas detection
To: <sales@qtech.example>

Dear Sir,
Kindly quote the following:
- Portable 4-gas detector (O2, CO, H2S, LEL) with charger: 3 Nos
- Calibration gas cylinder 34L mix: 2 Nos
Offer should reach us before 30th October 2026.

Regards,
Procurement Department
Karakoram Gases Limited`,
    items: [i('Portable 4-gas detector (O2, CO, H2S, LEL) with charger', 3, 'nos'), i('Calibration gas cylinder 34L mix', 2, 'nos')],
    ref: 'KGL-ENQ-55120',
    due: '2026-10-30',
    company: { name: 'Karakoram Gases Limited', domain: 'karakoramgases.com.pk' },
  },
  {
    name: 'PR number, a delivery date that is not the due date, and the due date',
    text: `AoA,
PR # 11000234
Material required at site by 30/11/2026.
Please send quotation by 27-10-2026.

1. Bearing SKF 6205 2RS - 20 Nos
2. Bearing SKF 6309 C3 - 10 Nos
3. V-belt B-52 - 12 Nos

Thanks
Store Incharge
Sunrise Paper Board Mills
0321-7654321`,
    items: [i('Bearing SKF 6205 2RS', 20, 'nos'), i('Bearing SKF 6309 C3', 10, 'nos'), i('V-belt B-52', 12, 'nos')],
    ref: '11000234',
    due: '2026-10-27',
    company: { name: 'Sunrise Paper Board Mills' },
  },
  {
    name: 'tender: subject line ref, closing date, a table with unit before qty',
    text: `Subject: Tender No. CGW/T-26/114 for instrumentation spares

Dear Sirs,
You are invited to quote for the following items. Closing date: 30.10.2026 at 11:00 hrs.

Sr.\tDescription\tUnit\tQty
1\tThermocouple type K, 6mm x 300mm, with head\tNos\t12
2\tCompensating cable type K, 2C x 1.5mm2\tMtr\t200
3\tTemperature indicator 96x96, K type input\tNos\t4

Yours faithfully,
Purchase Manager
Chenab Glass Works Ltd`,
    items: [
      i('Thermocouple type K, 6mm x 300mm, with head', 12, 'nos'),
      i('Compensating cable type K, 2C x 1.5mm2', 200, 'm'),
      i('Temperature indicator 96x96, K type input', 4, 'nos'),
    ],
    ref: 'CGW/T-26/114',
    due: '2026-10-30',
    company: { name: 'Chenab Glass Works Ltd' },
  },
  {
    name: 'numbered items with Size, Make and Qty lines under each',
    text: `Dear Sir,
Please quote for:

1. Electromagnetic flow meter
   Size: DN80
   Make: Endress+Hauser / Krohne
   Qty: 2 Nos
2. Ultrasonic level transmitter
   Range: 0-8 m
   Output: 4-20mA
   Qty: 1 No

Regards,
Faisal`,
    items: [
      i('Electromagnetic flow meter, Size: DN80, Make: Endress+Hauser / Krohne', 2, 'nos'),
      i('Ultrasonic level transmitter, Range: 0-8 m, Output: 4-20mA', 1, 'nos'),
    ],
  },
  {
    name: 'an item wrapped onto a second line keeps its quantity',
    text: `Dear Sir,
Kindly quote the following urgently required items:
1. Pressure transmitter, range 0-40 bar, 4-20mA with HART, SS316 wetted parts,
   1/2" NPT process connection, Make: Yokogawa EJA530E - 3 Nos
2. Digital temperature controller 48x48, relay output, 220VAC - 5 Nos`,
    items: [
      i('Pressure transmitter, range 0-40 bar, 4-20mA with HART, SS316 wetted parts, 1/2" NPT process connection, Make: Yokogawa EJA530E', 3, 'nos'),
      i('Digital temperature controller 48x48, relay output, 220VAC', 5, 'nos'),
    ],
  },
  {
    name: 'two items in one sentence, then a quoted Gmail reply',
    text: `Please quote 4 nos Schneider contactor LC1D32 220VAC coil and 4 nos overload relay LRD32.

Regards
Naveed

On Mon, 19 Oct 2026 at 15:02, Q-Tech Sales <sales@qtech.example> wrote:
> Dear Naveed, thank you for your enquiry.
> 1) MCCB 3P 100A - 2 Nos`,
    items: [i('Schneider contactor LC1D32 220VAC coil', 4, 'nos'), i('overload relay LRD32', 4, 'nos')],
  },
  {
    name: 'signature with no sign-off word: name, title, phones, address, email',
    text: `Please quote:
Gate valve 4" class 150 flanged WCB body - 10 Nos
Globe valve 2" class 300 SW - 4 Nos

Muhammad Imran
Maintenance Engineer
Tel: +92 21 3512 3456 | Fax: +92 21 3512 3457
Plot 23, Sector 15, Korangi Industrial Area, Karachi
imran@meherchemicals.com.pk`,
    items: [i('Gate valve 4" class 150 flanged WCB body', 10, 'nos'), i('Globe valve 2" class 300 SW', 4, 'nos')],
    company: { domain: 'meherchemicals.com.pk' },
  },
  {
    name: 'spreadsheet paste with S.No, Item Description, Part No, REQ QTY and UOM',
    text: `Dear Sir, please quote:
S.No\tItem Description\tPart No\tREQ QTY\tUOM
1\tPhotoelectric sensor diffuse 300mm PNP\tE3Z-D62\t6\tNos
2\tInductive sensor M12 4mm NPN\tE2E-X4C1\t10\tNos
3\tSafety relay 24VDC\tG9SA-301\t2\tNos`,
    items: [
      i('Photoelectric sensor diffuse 300mm PNP, Part No: E3Z-D62', 6, 'nos'),
      i('Inductive sensor M12 4mm NPN, Part No: E2E-X4C1', 10, 'nos'),
      i('Safety relay 24VDC, Part No: G9SA-301', 2, 'nos'),
    ],
  },
  {
    name: 'a table pasted with pipes',
    text: `Please quote below items.
| Sr# | Description | Make | Qty |
|---|---|---|---|
| 1 | VFD 7.5kW 380VAC | ABB ACS580 | 1 |
| 2 | VFD 15kW 380VAC | ABB ACS580 | 1 |`,
    items: [i('VFD 7.5kW 380VAC, Make: ABB ACS580', 1), i('VFD 15kW 380VAC, Make: ABB ACS580', 1)],
  },
  {
    name: 'Qty : 03 NOS, x2 and QTY: 10 EA on the item lines',
    text: `Assalam o Alaikum,
Need quotation for following:
Cable tray 300mm perforated GI, Qty : 03 NOS
Proximity sensor M30 x2
Push button green 22mm, QTY: 10 EA`,
    items: [i('Cable tray 300mm perforated GI', 3, 'nos'), i('Proximity sensor M30', 2), i('Push button green 22mm', 10, 'nos')],
  },
  {
    name: 'pasted with the email headers: ref in the subject, deadline in the body, sender domain',
    text: `From: Waqas Ali <waqas.ali@sialkottanneries.com>
Sent: Tuesday, October 20, 2026 9:15 AM
To: sales@qtech.example
Subject: RFQ-ST-2026-118 Pressure gauges

Dear Sir,
Please quote the following. Quotations must reach us before 26/10/2026.
Pressure gauge 0-10 bar 4" dial bottom entry - 8 nos
Pressure gauge 0-25 bar 2.5" dial back entry - 4 nos
Regards
Waqas Ali`,
    items: [i('Pressure gauge 0-10 bar 4" dial bottom entry', 8, 'nos'), i('Pressure gauge 0-25 bar 2.5" dial back entry', 4, 'nos')],
    ref: 'RFQ-ST-2026-118',
    due: '2026-10-26',
    company: { domain: 'sialkottanneries.com' },
  },
  {
    name: 'Urdu mix with no prefixes: chahiye, bhi, rate bata dein',
    text: `AoA sir
2 nos PT100 sensor 6mm x 100mm chahiye
1 no temperature transmitter head mount bhi
rate bata dein jaldi`,
    items: [i('PT100 sensor 6mm x 100mm', 2, 'nos'), i('temperature transmitter head mount', 1, 'nos')],
  },
  {
    name: 'Item No. labels with the quantity on the next line',
    text: `Dear Sir,
Please provide your best offer for:
Item No. 1: Butterfly valve DN150 PN16 wafer type, lever operated
Qty: 6 Nos
Item No. 2: Butterfly valve DN200 PN16 wafer type, gear operated
Qty: 4 Nos
Offer validity should be minimum 30 days.
Regards,
Kamran
Silver Star Textile Mills Ltd.`,
    items: [
      i('Butterfly valve DN150 PN16 wafer type, lever operated', 6, 'nos'),
      i('Butterfly valve DN200 PN16 wafer type, gear operated', 4, 'nos'),
    ],
    company: { name: 'Silver Star Textile Mills Ltd.' },
  },
  {
    name: 'letter markers, a note and an N.B. line',
    text: `Dear Supplier,

Please quote your lowest rates for the following:

a) Hydraulic hose 1/2" 2SN with fittings, 1.5 m length - 6 Nos
b) Hydraulic oil ISO VG 68 - 4 Drums

Note: Please mention brand, origin, delivery period and payment terms.
N.B. Partial quotations will not be considered.

Best Regards,
M. Saleem
Procurement Officer
Potohar Refinery Limited`,
    items: [i('Hydraulic hose 1/2" 2SN with fittings, 1.5 m length', 6, 'nos'), i('Hydraulic oil ISO VG 68', 4, 'drums')],
    company: { name: 'Potohar Refinery Limited' },
  },
  {
    name: 'bullets with (2 Nos) and a delivery line',
    text: `Dear Sir,
Please quote for the following spares for our boiler:
• Flame scanner Honeywell C7027A1049 (2 Nos)
• Ignition transformer 10kV (1 No)
• Burner controller LMV52 (1 No)
Required delivery: within 2 weeks.
Thanks,
Engr. Tahir
Jhang Valley Sugar Mills`,
    items: [i('Flame scanner Honeywell C7027A1049', 2, 'nos'), i('Ignition transformer 10kV', 1, 'nos'), i('Burner controller LMV52', 1, 'nos')],
    company: { name: 'Jhang Valley Sugar Mills' },
  },
  {
    name: 'one item in a sentence',
    text: `Hello,
We need 1 no 3 phase energy analyzer (Schneider PM5560 or equivalent) for our main LT panel. Please send your best price.
Regards,
Adeel
Gulf Petrochem (Pvt) Ltd`,
    items: [i('3 phase energy analyzer (Schneider PM5560 or equivalent) for our main LT panel', 1, 'nos')],
    company: { name: 'Gulf Petrochem (Pvt) Ltd' },
  },
  {
    name: 'Ref line, "1-" markers and a due date in words',
    text: `Dear Sir,
Ref: GG/PUR/2026/552
Kindly send your quotation by 23rd October 2026 for:
1- Thermostat 0-120C capillary type - 5 Nos
2- Thermometer bimetal 0-150C 4" dial - 5 Nos
Regards
Gujranwala Glass Industries (Pvt) Ltd`,
    items: [i('Thermostat 0-120C capillary type', 5, 'nos'), i('Thermometer bimetal 0-150C 4" dial', 5, 'nos')],
    ref: 'GG/PUR/2026/552',
    due: '2026-10-23',
    company: { name: 'Gujranwala Glass Industries (Pvt) Ltd' },
  },
  {
    name: 'enquiry letter read from a PDF: letterhead, enquiry no, date, last date for submission',
    text: `INDUS POWER DEMO LIMITED
Plant Site: 42 km Multan Road, Lahore
Ph: 042-37581000

ENQUIRY
Enquiry No: IPL/MM/ENQ/0912
Date: 19-OCT-26
Last date for submission of quotation: 02-NOV-26

S.No\tDescription\tQty\tUnit
1\tAnnunciator panel 16 window, 24VDC\t1\tNo.
2\tHooter 24VDC, 110dB\t2\tNos.`,
    items: [i('Annunciator panel 16 window, 24VDC', 1, 'nos'), i('Hooter 24VDC, 110dB', 2, 'nos')],
    ref: 'IPL/MM/ENQ/0912',
    due: '2026-11-02',
    company: { name: 'INDUS POWER DEMO LIMITED' },
  },
  {
    name: 'RFQ # and REQ QTY lines under numbered items',
    text: `Hi Team,
RFQ # 7700123
Please quote:
1. Contactor 3RT2026-1BB40, 24VDC coil
   REQ QTY: 6
2. Auxiliary contact block 3RH2911-1HA22
   REQ QTY: 6
3. Overload relay 3RU2126-4AB0, 11-16A
   REQ QTY: 6
Thanks,
Engr. Nadia Khan
Electrical Dept.
Fazal Cloth Mills Ltd | nadia.khan@fazalclothmills.com`,
    items: [
      i('Contactor 3RT2026-1BB40, 24VDC coil', 6),
      i('Auxiliary contact block 3RH2911-1HA22', 6),
      i('Overload relay 3RU2126-4AB0, 11-16A', 6),
    ],
    ref: '7700123',
    company: { name: 'Fazal Cloth Mills Ltd', domain: 'fazalclothmills.com' },
  },
  {
    name: 'Qty-2, x2 and "Sent from my iPhone"',
    text: `Sir please quote
Rotary encoder 1024 PPR 10-30VDC Qty-2
Coupling for encoder 6mm/10mm x2
Encoder cable 10m - 2 pcs
Sent from my iPhone`,
    items: [i('Rotary encoder 1024 PPR 10-30VDC', 2), i('Coupling for encoder 6mm/10mm', 2), i('Encoder cable 10m', 2, 'nos')],
  },
  {
    name: 'an RFQ that is all in the attachment: no items, but the ref and the deadline are in the text',
    text: `Dear Sir,
Please find attached our RFQ No. FFC-RFQ-26-0771 for instrumentation items. Kindly submit your quotation on or before 03/11/2026.
Regards,
Purchase Section
Fatima Fertilizer Demo Company Ltd.`,
    items: [],
    ref: 'FFC-RFQ-26-0771',
    due: '2026-11-03',
    company: { name: 'Fatima Fertilizer Demo Company Ltd.' },
  },
  {
    name: 'Qty: 2 Nos in the middle of the line, Make after it',
    text: `Dear Sir,
Please quote:
Gear motor 1.5kW, 40 RPM, Qty: 2 Nos, Make: SEW or Nord
Brake motor 0.75kW 4 pole, Qty: 1 No, Make: Siemens
Regards
Rehan`,
    items: [i('Gear motor 1.5kW, 40 RPM, Make: SEW or Nord', 2, 'nos'), i('Brake motor 0.75kW 4 pole, Make: Siemens', 1, 'nos')],
  },
]
