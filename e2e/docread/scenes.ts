/*
 * Fictional screenshots for the picture reader (ocr.spec.ts). Every name, company, number and item here is made up. Each scene
 * is HTML that Playwright renders and photographs at a phone's or a laptop's pixel density, plus `paste`: the same enquiry as
 * text, the way a person would paste it (for an email: all of it, as selecting the whole message and copying gives). The spec
 * reads the picture, runs both texts through parseEnquiry, and scores the items from the picture against the items from the
 * paste, or against `expected` when a scene states exactly what must come out (the Outlook RFQ, the owner's most common case).
 */

export interface ExpectedItem {
  description: string
  qty: number
  unit: string | null
}

export interface Scene {
  name: string
  /** What kind of screenshot it imitates, for the accuracy table. */
  kind: string
  viewport: { width: number; height: number }
  deviceScaleFactor: number
  html: string
  paste: string
  /** Counted in the >= 90% target (clean screenshots). */
  clean: boolean
  format?: 'png' | 'jpeg' | 'webp'
  /** What must come out, exactly: the items (unit included), the customer's reference and the company's email domain. */
  expected?: { items: ExpectedItem[]; customerRef: string; domain: string }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ------------------------------------------------------------------------------------------------ WhatsApp

interface Bubble {
  lines: string[]
  time: string
  out?: boolean
}

function whatsapp(contact: string, bubbles: Bubble[], dark: boolean): string {
  const c = dark
    ? { bg: '#0b141a', bar: '#202c33', inBg: '#202c33', outBg: '#005c4b', fg: '#e9edef', muted: '#8696a0' }
    : { bg: '#efeae2', bar: '#008069', inBg: '#ffffff', outBg: '#d9fdd3', fg: '#111b21', muted: '#667781' }
  const bubble = (b: Bubble) => `
    <div class="b ${b.out ? 'out' : 'in'}">
      ${b.lines.map(l => `<div>${esc(l)}</div>`).join('')}
      <div class="t">${esc(b.time)}${b.out ? ' <span class="tick">✓✓</span>' : ''}</div>
    </div>`
  return `<!doctype html><html><head><style>
    body { margin: 0; font-family: Roboto, Arial, Helvetica, sans-serif; background: ${c.bg}; color: ${c.fg}; }
    .status { display: flex; justify-content: space-between; padding: 6px 16px; font-size: 14px; background: ${c.bar}; color: #fff; }
    .head { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: ${c.bar}; color: #fff; font-size: 17px; }
    .av { width: 36px; height: 36px; border-radius: 50%; background: #9aa; }
    .chat { padding: 10px 8px 70px; display: flex; flex-direction: column; gap: 6px; }
    .day { align-self: center; font-size: 12px; padding: 4px 10px; border-radius: 6px; background: ${c.inBg}; color: ${c.muted}; }
    .b { max-width: 82%; padding: 6px 8px 4px; border-radius: 8px; font-size: 15.5px; line-height: 21px; }
    .in { align-self: flex-start; background: ${c.inBg}; }
    .out { align-self: flex-end; background: ${c.outBg}; }
    .t { text-align: right; font-size: 11px; color: ${c.muted}; line-height: 14px; }
    .tick { color: #53bdeb; }
    .bar { position: fixed; bottom: 0; left: 0; right: 0; padding: 8px; background: ${c.bg}; }
    .input { border-radius: 22px; padding: 11px 16px; background: ${c.inBg}; color: ${c.muted}; font-size: 16px; }
  </style></head><body>
    <div class="status"><span>9:41</span><span>4G 87%</span></div>
    <div class="head"><div class="av"></div><div><div>${esc(contact)}</div><div style="font-size:12px;opacity:.8">online</div></div></div>
    <div class="chat"><div class="day">Today</div>${bubbles.map(bubble).join('')}</div>
    <div class="bar"><div class="input">Message</div></div>
  </body></html>`
}

// ------------------------------------------------------------------------------------------------ email

function email(opts: { from: string; subject: string; body: string[]; table?: string[][]; after?: string[]; phone?: boolean }): string {
  const table = opts.table
    ? `<table>${opts.table
        .map((r, i) => `<tr>${r.map(c => (i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`)
        .join('')}</table>`
    : ''
  const p = (ls: string[]) => ls.map(l => (l === '' ? '<br>' : `<div>${esc(l)}</div>`)).join('')
  return `<!doctype html><html><head><style>
    body { margin: 0; font-family: "Segoe UI", Arial, Helvetica, sans-serif; background: #fff; color: #201f1e; font-size: ${opts.phone ? 15 : 14}px; line-height: 1.45; }
    .top { padding: 12px 20px; border-bottom: 1px solid #e1dfdd; }
    .subj { font-size: ${opts.phone ? 19 : 20}px; font-weight: 600; margin-bottom: 8px; }
    .meta { color: #605e5c; font-size: 13px; }
    .body { padding: 16px 20px; }
    table { border-collapse: collapse; margin: 10px 0; }
    th, td { border: 1px solid #8a8886; padding: 4px 10px; text-align: left; }
    th { background: #f3f2f1; }
  </style></head><body>
    <div class="top"><div class="subj">${esc(opts.subject)}</div><div class="meta">${esc(opts.from)}<br>To: sales@example.com<br>Mon 19/10/2026 11:05</div></div>
    <div class="body">${p(opts.body)}${table}${p(opts.after ?? [])}</div>
  </body></html>`
}

/** The same email as text: what selecting the whole message and copying it gives. */
function emailText(opts: { from: string; subject: string; body: string[]; table?: string[][]; after?: string[] }): string {
  return [opts.subject, opts.from, 'To: sales@example.com', 'Mon 19/10/2026 11:05', '', ...opts.body, ...(opts.table ? ['', tsv(opts.table)] : []), ...(opts.after ?? [])].join('\n')
}

// ------------------------------------------------------------------------------------------------ Outlook RFQ

interface OutlookRfq {
  from: string
  sent: string
  subject: string
  intro: string[]
  /** Description, quantity, unit. No header row. */
  rows: Array<[string, number, string]>
  signature: string[]
}

/**
 * The owner's most common enquiry: an Outlook message with the header block, a short polite body, a ruled table with no header
 * row (description left, quantity right-aligned far right, the unit in its own column), then a signature with a logo.
 * `shaded`: alternate rows light blue. `photo`: a phone photo of the screen (tilted, soft, a little moiré, warm light).
 */
function outlook(m: OutlookRfq, opts: { shaded?: boolean; photo?: boolean } = {}): string {
  const rows = m.rows
    .map(([d, q, u], i) => `<tr${opts.shaded && i % 2 === 1 ? ' class="alt"' : ''}><td class="d">${esc(d)}</td><td class="q">${q}</td><td class="u">${esc(u)}</td></tr>`)
    .join('')
  const head = (k: string, v: string) => `<div><b>${k}</b> ${esc(v)}</div>`
  const page = `
    <div class="mail">
      ${head('From:', m.from)}${head('Sent:', m.sent)}${head('To:', 'sales@example.com')}${head('Subject:', m.subject)}
      <br>${m.intro.map(l => (l === '' ? '<br>' : `<div>${esc(l)}</div>`)).join('')}
      <table>${rows}</table>
      <div>Regards,</div><br>
      <div class="logo">FPS</div>
      ${m.signature.map((l, i) => `<div${i === 0 ? ' class="name"' : ''}>${esc(l)}</div>`).join('')}
    </div>`
  const photo = opts.photo
    ? `body { background: #3a3631; padding: 30px; }
       .screen { transform: perspective(1400px) rotateX(4deg) rotateZ(-1.2deg); filter: blur(0.7px) brightness(0.93) sepia(0.15); }
       .screen::after { content: ''; position: absolute; inset: 0; pointer-events: none;
         background: repeating-linear-gradient(0deg, rgba(0,0,0,.035) 0 1px, transparent 1px 3px); }`
    : ''
  return `<!doctype html><html><head><style>
    body { margin: 0; background: #fff; }
    .screen { position: relative; background: #fff; }
    .mail { padding: 14px 22px; font-family: Calibri, Carlito, "Segoe UI", Arial, sans-serif; font-size: 14.7px; line-height: 1.35; color: #000; }
    table { border-collapse: collapse; margin: 12px 0 16px; }
    td { border: 1px solid #000; padding: 2px 6px; }
    td.d { width: 420px; }
    td.q { width: 70px; text-align: right; }
    td.u { width: 40px; text-align: center; }
    tr.alt td { background: #dce6f1; }
    .logo { display: inline-block; margin: 2px 0 6px; padding: 6px 12px; background: #1f4e79; color: #fff; font: bold 20px Georgia, serif; letter-spacing: 2px; }
    .name { font-weight: bold; color: #1f4e79; }
    ${photo}
  </style></head><body><div class="screen">${page}</div></body></html>`
}

function outlookText(m: OutlookRfq): string {
  return [
    `From: ${m.from}`,
    `Sent: ${m.sent}`,
    'To: sales@example.com',
    `Subject: ${m.subject}`,
    '',
    ...m.intro,
    '',
    ...m.rows.map(r => r.join('\t')),
    '',
    'Regards,',
    '',
    ...m.signature,
  ].join('\n')
}

const RFQ_131026: OutlookRfq = {
  from: 'Asad Mehmood <asad.mehmood@fictional-power.example>',
  sent: 'Tuesday, October 13, 2026 10:21 AM',
  subject: 'RFQ FOR THE ELECTRONICS ITEMS REQUIRED 131026',
  intro: ['Dear Sir,', '', 'Hope you are doing well.', 'Please share the price and availability for the below mentioned parts.'],
  rows: [
    ['CAPACITOR 100UF 450 V-01', 10, 'EA'],
    ['OPTO COUPLER A 3120 , TYPE SMD, 8 PIN-01', 25, 'EA'],
    ['IGBT VINCO P830A3203 -01', 4, 'EA'],
    ['RESISTOR 10K 1/4 W-01', 100, 'EA'],
    ['DIODE FAST RECOVERY 1N4937-01', 50, 'EA'],
    ['VOLTAGE REGULATOR 7805 TO-220-01', 20, 'EA'],
    ['RELAY 24VDC 2 CO PCB MOUNT-01', 12, 'EA'],
    ['FUSE GLASS 5X20 2A-01', 200, 'EA'],
  ],
  signature: [
    'Asad Mehmood',
    'Senior Engineer Procurement',
    'Fictional Power Systems (Pvt) Ltd',
    'Mobile : +92 300 0000000',
    'Plot 00, Industrial Estate, Fictional City',
    'www.fictional-power.example',
  ],
}

// The unit is kept as the customer wrote it (EA). The trailing "-01" is the customer's line code: kept as text, never a quantity.
const RFQ_EXPECTED = {
  items: RFQ_131026.rows.map(([description, qty, unit]) => ({ description, qty, unit })),
  customerRef: '131026',
  domain: 'fictional-power.example',
}

// ------------------------------------------------------------------------------------------------ Excel

function excel(rows: string[][], opts: { chrome: boolean }): string {
  const letters = 'ABCDEFGH'
  const head = opts.chrome ? `<tr><th class="c"></th>${rows[0]!.map((_, i) => `<th class="c">${letters[i]}</th>`).join('')}</tr>` : ''
  const body = rows
    .map((r, i) => `<tr>${opts.chrome ? `<th class="c">${i + 1}</th>` : ''}${r.map(c => `<td${i === 0 ? ' class="h"' : ''}>${esc(c)}</td>`).join('')}</tr>`)
    .join('')
  return `<!doctype html><html><head><style>
    body { margin: 0; padding: 8px; font-family: Calibri, Carlito, Arial, Helvetica, sans-serif; font-size: 15px; background: #fff; color: #000; }
    table { border-collapse: collapse; }
    td, th { border: 1px solid #d4d4d4; padding: 2px 6px; height: 20px; white-space: nowrap; }
    td.h { font-weight: bold; background: #ddebf7; }
    th.c { background: #f3f3f3; color: #444; font-weight: normal; font-size: 13px; text-align: center; min-width: 24px; }
  </style></head><body><table>${head}${body}</table></body></html>`
}

const tsv = (rows: string[][]) => rows.map(r => r.join('\t')).join('\n')

// ------------------------------------------------------------------------------------------------ the scenes

const PHONE = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2.75 }
const LAPTOP = { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 }

const waList = [
  'Please quote for the following:',
  '1. Pressure transmitter 0-10 bar 4-20mA - 2 nos',
  '2. Contactor 3RT2026-1BB40 24VDC coil - 4 nos',
  '3. Proximity sensor M18 PNP NO - 10 nos',
  '4. MCB 2 pole C16 - 6 nos',
  '5. Pressure gauge 0-16 bar 100mm dial - 3 nos',
]

const waDark = ['Rates please', 'Solenoid valve 1/2 inch 24VDC qty 3', 'Temperature gauge 0-150 C 100mm dial qty 5', 'Cable gland PG16 brass qty 50', 'VFD 7.5 kW 400V qty 1']

const emailList = [
  'Dear Sir,',
  '',
  'Kindly quote your best price and delivery for the following items:',
  '',
  '1) Level switch float type SS316 - 2 Nos',
  '2) Solenoid valve 1 inch 220VAC brass - 4 Nos',
  '3) Thermocouple type K 300mm with head - 6 Nos',
  '4) Limit switch roller lever - 8 Nos',
  '',
  'Please send the quotation by 28 October 2026.',
  '',
  'Regards,',
  'Imran Qureshi',
  'Purchase Department',
  'Fictional Sugar Mills Ltd',
]

const sheet = [
  ['S.No', 'Description', 'Part No', 'Qty', 'Unit'],
  ['1', 'Pressure gauge 0-16 bar 100mm dial', 'PG-100-16', '4', 'Nos'],
  ['2', 'Thermocouple type K 300mm', 'TC-K-300', '6', 'Nos'],
  ['3', 'Limit switch roller lever', 'LS-RL-01', '8', 'Nos'],
  ['4', 'Power supply 24VDC 10A', '6EP1334-2BA20', '2', 'Nos'],
  ['5', 'Relay 24VDC 2CO with base', 'RL-24-2CO', '20', 'Nos'],
  ['6', 'Flow meter electromagnetic DN50', 'FM-DN50', '1', 'Set'],
]

const mailTable = [
  ['Item', 'Description', 'Qty', 'UOM'],
  ['1', 'Ball valve 2 inch SS316 flanged', '5', 'Nos'],
  ['2', 'Butterfly valve DN100 with gear', '2', 'Nos'],
  ['3', 'Pressure switch 1-10 bar', '3', 'Nos'],
  ['4', 'Cable 4 core 2.5 mm2 armoured', '200', 'Meters'],
]

const emailDesktop = { from: 'Imran Qureshi <imran@fictional-sugar.example>', subject: 'RFQ-2026-118 Instrumentation spares', body: emailList }
const emailPhone = { ...emailDesktop, subject: 'RFQ-2026-118', phone: true }
const emailTable = {
  from: 'Sana Malik <sana@fictional-cement.example>',
  subject: 'Enquiry for valves',
  body: ['Dear Team,', '', 'Please quote the items below.'],
  table: mailTable,
  after: ['', 'Thanks,', 'Sana'],
}

export const SCENES: Scene[] = [
  {
    name: 'outlook-rfq',
    kind: 'Outlook RFQ, laptop (no header row)',
    viewport: { width: 1366, height: 700 },
    deviceScaleFactor: 1,
    html: outlook(RFQ_131026),
    paste: outlookText(RFQ_131026),
    clean: true,
    expected: RFQ_EXPECTED,
  },
  {
    name: 'outlook-rfq-shaded',
    kind: 'Outlook RFQ, alternate rows shaded, 125%',
    viewport: { width: 1280, height: 700 },
    deviceScaleFactor: 1.25,
    html: outlook(RFQ_131026, { shaded: true }),
    paste: outlookText(RFQ_131026),
    clean: true,
    expected: RFQ_EXPECTED,
  },
  {
    name: 'outlook-rfq-photo',
    kind: 'Outlook RFQ, phone photo of the screen (JPEG)',
    viewport: { width: 760, height: 760 },
    deviceScaleFactor: 2,
    html: outlook(RFQ_131026, { shaded: true, photo: true }),
    paste: outlookText(RFQ_131026),
    clean: false,
    format: 'jpeg',
    expected: RFQ_EXPECTED,
  },
  {
    name: 'whatsapp-light',
    kind: 'WhatsApp, phone, light',
    ...PHONE,
    html: whatsapp('Bilal (Fictional Textiles)', [
      { lines: ['Assalam o alaikum'], time: '10:40 am' },
      { lines: waList, time: '10:42 am' },
      { lines: ['Ok, will send today'], time: '10:45 am', out: true },
    ], false),
    paste: waList.join('\n'),
    clean: true,
  },
  {
    name: 'whatsapp-dark',
    kind: 'WhatsApp, phone, dark mode',
    ...PHONE,
    html: whatsapp('Kamran Fictional Foods', [{ lines: waDark, time: '4:05 pm' }], true),
    paste: waDark.join('\n'),
    clean: true,
  },
  {
    name: 'email-desktop',
    kind: 'Email, laptop',
    ...LAPTOP,
    viewport: { width: 1280, height: 640 },
    html: email(emailDesktop),
    paste: emailText(emailDesktop),
    clean: true,
  },
  {
    name: 'email-table',
    kind: 'Email with a table, laptop',
    ...LAPTOP,
    viewport: { width: 1100, height: 520 },
    deviceScaleFactor: 1.25,
    html: email(emailTable),
    paste: emailText(emailTable),
    clean: true,
  },
  {
    name: 'excel-range',
    kind: 'Excel range, laptop',
    viewport: { width: 900, height: 220 },
    deviceScaleFactor: 1,
    html: excel(sheet, { chrome: false }),
    paste: tsv(sheet),
    clean: true,
  },
  {
    name: 'excel-window',
    kind: 'Excel with row numbers and column letters',
    viewport: { width: 960, height: 240 },
    deviceScaleFactor: 1,
    html: excel(sheet, { chrome: true }),
    paste: tsv(sheet),
    clean: true,
  },
  {
    name: 'email-phone',
    kind: 'Email, phone (JPEG)',
    ...PHONE,
    html: email(emailPhone),
    paste: emailText(emailPhone),
    clean: true,
    format: 'jpeg',
  },
  {
    name: 'whatsapp-webp',
    kind: 'WhatsApp, phone, WebP',
    ...PHONE,
    html: whatsapp('Bilal (Fictional Textiles)', [{ lines: waList, time: '10:42 am' }], false),
    paste: waList.join('\n'),
    clean: true,
    format: 'webp',
  },
]

/** A picture with no text: the reader must say it could not read it, not invent items. */
export const NO_TEXT = `<!doctype html><html><body style="margin:0;background:linear-gradient(135deg,#7aa,#dcb)"><div style="width:600px;height:400px"></div></body></html>`
