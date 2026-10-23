// Template generations 29 and 30 (feat/reader-gaps): the two formats the reader was weakest on, as families of their own, written
// before the reader was changed for them and first measured blind on a held-out batch (corpus.ts, batches 31 and 32).
// 29: an ERP RFQ form from a Pakistani plant: letterhead, a boxed header (RFQ No, dates, vendor, buyer), a ruled item table with
//     columns such as S.No / Item Code / Description / UOM / Qty / Required Date, ERP quantities ("2.000", "1,000.000", "0.500"),
//     the header repeated on every page, a signature footer under every page, terms and conditions after the last page.
// 30: a Word letter: letterhead, Ref and Date, "To, The Sales Manager, M/s Q-Tech Engineering", Subject, "Dear Sir, please quote
//     for the following:" then the items numbered "1)", "(a)", "i." or in a Word table, with Make / Model / Qty lines under an
//     item, "2 (Two) Nos", dot leaders, items in one sentence, numbered terms after the items, a signature block and a second page.
// Every company, person, brand, address, phone number, reference and part number is invented; part numbers only follow the
// SHAPES of Siemens, Endress+Hauser and ABB catalogue numbers, with random characters.

import type { Block, Doc, ItemTruth } from './model'
import type { EnquiryTemplate } from './enquiries'
import type { Rng } from './rng'
import { writeUnit } from './units'
import { dateAfter, writeDate } from './vocab'

// ------------------------------------------------------------------------------------------------ customers

const SYL_A = ['Zar', 'Nur', 'Kas', 'Mehr', 'Sab', 'Tal', 'Daw', 'Raf', 'Hel', 'Qam', 'Shan', 'Vel', 'Yar', 'Bah', 'Gul', 'Fir', 'Ark', 'Sol']
const SYL_B = ['wan', 'lak', 'dar', 'oon', 'abad', 'pur', 'ina', 'ez', 'iq', 'ora', 'eem', 'ani']
const TRADE = ['Polymer Industries', 'Fibres', 'Cement Works', 'Fertilizer Company', 'Refinery', 'Power Company', 'Steel Mills', 'Packages', 'Glass Industries', 'Ghee & Oil Mills', 'Paper Mills', 'Chemicals', 'Sugar Mills', 'Textile Mills', 'Pharmaceuticals', 'Beverages']
const SUFFIX = ['Limited', 'Ltd', '(Pvt) Ltd', '(Private) Limited', 'Pvt. Ltd.']
const CITY = ['Faisalabad', 'Lahore', 'Karachi', 'Multan', 'Sheikhupura', 'Hattar', 'Gujranwala', 'Sialkot', 'Rahim Yar Khan', 'Haripur', 'Nooriabad', 'Port Qasim', 'Chakwal', 'Sahiwal']
const AREA = ['Industrial Estate', 'Small Industrial Estate', 'Main Super Highway', 'Sargodha Road', 'Multan Road', 'GT Road', 'Raiwind Road', 'Industrial Zone', 'Export Processing Zone', 'Sheikhupura Road']
const FIRST = ['Arsalan', 'Babar', 'Danyal', 'Ehsan', 'Ghazanfar', 'Haris', 'Irfan', 'Jawad', 'Khurram', 'Luqman', 'Moazzam', 'Noman', 'Obaid', 'Pervaiz', 'Rashid', 'Shoaib', 'Taimoor', 'Umair', 'Waleed', 'Zubair', 'Amna', 'Rabia', 'Saima']
const LAST = ['Ashraf', 'Bajwa', 'Cheema', 'Durrani', 'Farooqi', 'Ghauri', 'Hussain', 'Jamil', 'Kiani', 'Lodhi', 'Minhas', 'Niazi', 'Paracha', 'Qazi', 'Randhawa', 'Shah', 'Tarar', 'Warraich', 'Yousaf']
const TITLES = ['Purchase Officer', 'Manager Procurement', 'Senior Buyer', 'Deputy Manager Supply Chain', 'Store Incharge', 'Procurement Executive', 'Assistant Manager Purchase', 'Head of Procurement', 'Manager Instrumentation', 'Senior Engineer (E&I)']
const DEPT = ['Instrumentation Department', 'Electrical Maintenance', 'Utilities', 'Boiler House', 'Spinning Unit-2', 'Kiln Section', 'Packing Plant', 'Water Treatment Plant', 'Process Control', 'Engineering Stores']

interface Industrial {
  name: string
  domain: string
  city: string
  address: string
  person: string
  title: string
  phone: string
  landline: string
  email: string
  code: string
  dept: string
}

function industrial(r: Rng): Industrial {
  const word = `${r.pick(SYL_A)}${r.pick(SYL_B)}`
  const trade = r.pick(TRADE)
  const name = `${word} ${trade} ${r.pick(SUFFIX)}`
  const city = r.pick(CITY)
  const first = r.pick(FIRST)
  const last = r.pick(LAST)
  const domain = `${word.toLowerCase()}${r.pick(['group', 'pk', 'ind', ''])}.${r.pick(['example.pk', 'example.com.pk', 'example.com'])}`
  const code = `${word.slice(0, 2)}${trade.split(/\s+/).map(w => w[0]).join('')}`.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)
  return {
    name,
    domain,
    city,
    address: `${r.pick(['Plot', 'Plot No.', 'Factory'])} ${r.int(3, 240)}${r.pick(['', '-A', '-B', '/1'])}, ${r.pick(AREA)}, ${city}`,
    person: `${first} ${last}`,
    title: r.pick(TITLES),
    phone: `0${r.pick(['300', '301', '321', '333', '345', '312'])}-${r.int(1000000, 9999999)}`,
    landline: `+92-${r.pick(['42', '41', '21', '61', '51', '68', '995'])}-${r.int(3000000, 8999999)}`,
    email: `${r.pick(['purchase', 'procurement', 'scm', `${first.toLowerCase()}.${last.toLowerCase()}`])}@${domain}`,
    code,
    dept: r.pick(DEPT),
  }
}

// ------------------------------------------------------------------------------------------------ items

const D = (r: Rng, n: number) => Array.from({ length: n }, () => r.int(0, 9)).join('')
const L = (r: Rng, n: number) => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPRSTUVWXYZ'[r.int(0, 22)]).join('')

/** Catalogue-number shapes: Siemens (6ES7, 3RT, 3RV, 6SL, 7MF, 7ML), Endress+Hauser (PMC, FMU, 5P, CPS, TMT), ABB (2CDS, 1SDA, ACS, 1SVR). */
const SHAPE = {
  plc: (r: Rng) => `6ES7${r.chance(0.4) ? ' ' : ''}${D(r, 3)}-${D(r, 1)}${L(r, 2)}${D(r, 2)}-0${L(r, 2)}0`,
  contactor: (r: Rng) => r.pick([`3RT20${D(r, 2)}-${D(r, 1)}${L(r, 2)}${D(r, 2)}`, `1SBL${D(r, 6)}R${D(r, 4)}`]),
  mpcb: (r: Rng) => `3RV20${D(r, 2)}-${D(r, 1)}${L(r, 1)}A${D(r, 2)}`,
  drive: (r: Rng) => r.pick([`6SL32${D(r, 2)}-${D(r, 1)}${L(r, 2)}${D(r, 2)}-${D(r, 1)}U${L(r, 1)}${D(r, 1)}`, `ACS${r.pick(['355', '380', '580', '880'])}-01-${D(r, 2)}A${D(r, 1)}-4`]),
  pressure: (r: Rng) => r.pick([`7MF${D(r, 4)}-${D(r, 1)}${L(r, 2)}${D(r, 2)}-${D(r, 1)}${L(r, 2)}${D(r, 1)}`, `PMC${D(r, 2)}-${L(r, 3)}${D(r, 1)}${L(r, 1)}${D(r, 1)}${L(r, 5)}`, `PMP${D(r, 2)}-${L(r, 2)}${D(r, 1)}${L(r, 4)}`]),
  level: (r: Rng) => r.pick([`7ML5${D(r, 3)}-${D(r, 1)}${L(r, 2)}${D(r, 2)}`, `FMU${D(r, 2)}-${L(r, 8)}`]),
  flow: (r: Rng) => `5P${D(r, 1)}B${D(r, 2)}-${L(r, 2)}${D(r, 1)}${L(r, 1)}${D(r, 1)}${L(r, 2)}${D(r, 1)}`,
  ph: (r: Rng) => `CPS${D(r, 2)}E-${L(r, 2)}${D(r, 1)}${L(r, 3)}${D(r, 1)}`,
  temp: (r: Rng) => `TMT${D(r, 2)}-${L(r, 1)}${D(r, 1)}${L(r, 3)}`,
  mcb: (r: Rng) => `2CDS2${D(r, 5)}R0${D(r, 3)}`,
  mccb: (r: Rng) => `1SDA0${D(r, 5)}R1`,
  relay: (r: Rng) => r.pick([`1SVR${D(r, 6)}R${D(r, 4)}`, `3RH21${D(r, 2)}-1B${L(r, 1)}40`]),
}

const BRANDS = ['Voltreg', 'Hydronix', 'Kesselberg', 'Aurion', 'Brennor', 'Tavira', 'Meridex', 'Norvalt']

interface Kind {
  noun: string
  erp: string
  specs: Array<(r: Rng) => string>
  part: ((r: Rng) => string) | null
  units: string[]
  qty: (r: Rng, fam: string) => number
}

const count = (r: Rng) => r.pick([1, 1, 2, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20])
const bulk = (r: Rng, fam: string) =>
  fam === 'm' ? r.pick([0.5, 2.5, 12.5, 25, 50, 100, 150, 250, 500, 1000, 1500]) : fam === 'kg' ? r.pick([0.5, 1.5, 2.5, 5, 10, 20, 25, 50]) : fam === 'l' ? r.pick([0.5, 1, 4, 5, 20, 200, 208]) : r.pick([50, 100, 200, 500, 1000, 1500, 2000])

const KINDS: Kind[] = [
  { noun: 'PLC CPU', erp: 'PLC,CPU', specs: [r => `${r.pick([14, 24, 40])} DI/${r.pick([10, 16])} DO`, () => '24VDC', r => r.pick(['PROFINET', 'with memory card'])], part: SHAPE.plc, units: ['nos', 'ea', 'set'], qty: r => r.pick([1, 1, 2]) },
  { noun: 'Analog input module', erp: 'MODULE,ANALOG INPUT', specs: [r => `${r.pick([4, 8])} AI`, () => '4-20mA', () => '16 bit'], part: SHAPE.plc, units: ['nos', 'ea'], qty: r => r.pick([1, 2, 3, 4]) },
  { noun: 'Digital output module', erp: 'MODULE,DIGITAL OUTPUT', specs: [r => `${r.pick([8, 16, 32])} DO`, () => '24VDC 0.5A'], part: SHAPE.plc, units: ['nos', 'ea'], qty: r => r.pick([1, 2, 3, 4]) },
  { noun: 'Contactor', erp: 'CONTACTOR,POWER', specs: [r => `${r.pick([9, 12, 18, 25, 32, 40, 65])}A`, r => `coil ${r.pick(['24VDC', '230VAC', '110VAC'])}`, () => '1NO+1NC'], part: SHAPE.contactor, units: ['nos', 'ea', 'pcs'], qty: count },
  { noun: 'Motor protection circuit breaker', erp: 'BREAKER,MOTOR PROTECTION', specs: [r => `${r.pick(['1.8-2.5', '4.5-6.3', '9-12.5', '14-20', '17-22'])}A`, () => '3 pole'], part: SHAPE.mpcb, units: ['nos', 'ea'], qty: count },
  { noun: 'Variable frequency drive', erp: 'DRIVE,AC VARIABLE FREQUENCY', specs: [r => `${r.pick([1.5, 2.2, 5.5, 7.5, 11, 15, 22, 45])} kW`, () => '380-480V 3 phase', r => r.pick(['IP20', 'with operator panel'])], part: SHAPE.drive, units: ['nos', 'set', 'ea'], qty: r => r.pick([1, 1, 2]) },
  { noun: 'Pressure transmitter', erp: 'TRANSMITTER,PRESSURE', specs: [r => `0-${r.pick([4, 10, 16, 25, 40, 100])} bar`, () => '4-20mA HART', r => r.pick(['1/2" NPT', 'G1/2 male', 'SS316L diaphragm'])], part: SHAPE.pressure, units: ['nos', 'ea', 'set'], qty: count },
  { noun: 'Ultrasonic level transmitter', erp: 'TRANSMITTER,LEVEL ULTRASONIC', specs: [r => `range ${r.pick([5, 8, 10, 15])} m`, () => '4-20mA', () => '2 wire'], part: SHAPE.level, units: ['nos', 'set'], qty: r => r.pick([1, 1, 2]) },
  { noun: 'Electromagnetic flow meter', erp: 'FLOWMETER,ELECTROMAGNETIC', specs: [r => `DN${r.pick([25, 40, 50, 80, 100, 150])}`, () => 'PN16', r => r.pick(['PTFE liner', 'hard rubber liner'])], part: SHAPE.flow, units: ['nos', 'set'], qty: r => r.pick([1, 1, 2]) },
  { noun: 'pH sensor', erp: 'SENSOR,PH', specs: [() => '0-14 pH', r => r.pick(['with temperature sensor', 'gel electrolyte'])], part: SHAPE.ph, units: ['nos', 'pcs'], qty: count },
  { noun: 'Temperature transmitter', erp: 'TRANSMITTER,TEMPERATURE', specs: [r => `PT100 ${r.pick(['0-150', '0-200', '0-400'])} C`, () => 'head mounted', () => '4-20mA'], part: SHAPE.temp, units: ['nos', 'ea'], qty: count },
  { noun: 'Miniature circuit breaker', erp: 'BREAKER,MINIATURE', specs: [r => `${r.pick([1, 2, 3])} pole`, r => `${r.pick(['B', 'C'])}${r.pick([6, 10, 16, 20, 32])}`, () => '6kA'], part: SHAPE.mcb, units: ['nos', 'pcs', 'ea'], qty: count },
  { noun: 'Moulded case circuit breaker', erp: 'BREAKER,MOULDED CASE', specs: [r => `${r.pick([100, 160, 250, 400])}A`, () => '3 pole', r => `${r.pick([36, 50])}kA`], part: SHAPE.mccb, units: ['nos', 'ea'], qty: r => r.pick([1, 1, 2, 3]) },
  { noun: 'Timer relay', erp: 'RELAY,TIMER', specs: [() => 'on delay', () => '24-240V AC/DC', r => `${r.pick([1, 2])} c/o`], part: SHAPE.relay, units: ['nos', 'pcs', 'ea'], qty: count },
  { noun: 'Control cable', erp: 'CABLE,CONTROL', specs: [r => `${r.pick([2, 4, 7, 12, 19])} core x ${r.pick([0.75, 1.5, 2.5])} mm2`, r => r.pick(['shielded', 'PVC/PVC', 'armoured'])], part: null, units: ['m'], qty: bulk },
  { noun: 'Instrument cable', erp: 'CABLE,INSTRUMENT', specs: [r => `${r.pick([1, 2, 4])} pair x ${r.pick([0.75, 1.0, 1.5])} mm2`, () => 'overall screened'], part: null, units: ['m'], qty: bulk },
  { noun: 'Lithium grease', erp: 'GREASE,LITHIUM', specs: [r => `NLGI ${r.pick([2, 3])}`, () => 'EP'], part: null, units: ['kg'], qty: bulk },
  { noun: 'Welding electrode', erp: 'ELECTRODE,WELDING', specs: [r => `E${r.pick(['6013', '7018'])}`, r => `${r.pick([2.5, 3.2, 4.0])} mm`], part: null, units: ['kg'], qty: bulk },
  { noun: 'Hydraulic oil', erp: 'OIL,HYDRAULIC', specs: [r => `ISO VG ${r.pick([32, 46, 68])}`], part: null, units: ['l'], qty: bulk },
  { noun: 'Cable tie', erp: 'TIE,CABLE', specs: [r => `${r.pick([150, 200, 300, 370])} mm`, r => r.pick(['nylon black', 'UV resistant'])], part: null, units: ['nos', 'pcs'], qty: (r, f) => (r.chance(0.7) ? bulk(r, f) : count(r)) },
  { noun: 'PVC insulation tape', erp: 'TAPE,INSULATION PVC', specs: [() => '19 mm', r => r.pick(['black', 'red', 'yellow'])], part: null, units: ['roll', 'nos'], qty: r => r.pick([10, 20, 25, 50, 100]) },
  { noun: 'Cable lug', erp: 'LUG,CABLE COPPER', specs: [r => `${r.pick([6, 10, 16, 25, 35, 70])} mm2`, () => 'ring type'], part: null, units: ['nos', 'pcs', 'box'], qty: (r, f) => (f === 'box' ? r.pick([1, 2, 5]) : bulk(r, f)) },
  { noun: 'Ball bearing', erp: 'BEARING,DEEP GROOVE BALL', specs: [r => `${r.pick(['6205', '6308', '6310', '6312', '6205'])} ${r.pick(['2RS', 'ZZ', 'C3'])}`], part: null, units: ['nos', 'pcs', 'pair'], qty: count },
  { noun: 'Solenoid valve', erp: 'VALVE,SOLENOID', specs: [r => `${r.pick(['1/4', '1/2', '1'])}" BSP`, () => '2/2 way NC', r => r.pick(['24VDC', '230VAC'])], part: null, units: ['nos', 'ea'], qty: count },
]

interface Item {
  noun: string
  /** The specification words after the noun ("0-16 bar, 4-20mA HART"). */
  spec: string
  /** Natural words: "Pressure transmitter 0-16 bar, 4-20mA HART". */
  plain: string
  caps: string
  /** ERP master text: "TRANSMITTER,PRESSURE;0-16BAR,4-20MAHART". */
  erp: string
  part: string | null
  brand: string | null
  fam: string
  qty: number
}

function items(r: Rng, n: number): Item[] {
  const out: Item[] = []
  const seen = new Set<string>()
  let guard = 0
  while (out.length < n && guard++ < n * 30) {
    const k = r.pick(KINDS)
    const specs = k.specs.filter(() => r.chance(0.8)).map(s => s(r))
    if (specs.length === 0) specs.push((k.specs[0] as (r: Rng) => string)(r))
    // The same kind twice only in a long list (and then with other specifications).
    const key = `${k.noun} ${specs.join(' ')}`.toLowerCase()
    if (seen.has(key) || (seen.size < 18 && [...seen].some(s => s.startsWith(`${k.noun.toLowerCase()} `)))) continue
    seen.add(key)
    const part = k.part && r.chance(0.8) ? k.part(r) : null
    const brand = part || r.chance(0.3) ? r.pick(BRANDS) : null
    const fam = r.pick(k.units)
    const spec = r.chance(0.5) ? specs.join(', ') : specs.join(' ')
    out.push({
      noun: k.noun,
      spec,
      plain: `${k.noun} ${spec}`,
      caps: `${k.noun.toUpperCase()} ${specs.map(s => s.toUpperCase()).join(', ')}`,
      erp: `${k.erp};${specs.map(s => s.toUpperCase().replace(/\s+/g, '')).join(',')}`,
      part,
      brand,
      fam,
      qty: k.qty(r, fam),
    })
  }
  return out
}

/** A quantity as an ERP prints it ("2.000", "1,000.000", "0.500"), or plainly ("2", "1,000", "0.5", "02"). */
function qtyText(n: number, style: 'erp3' | 'erp2' | 'plain' | 'pad'): string {
  if (style === 'erp3' || style === 'erp2') return n.toLocaleString('en-US', { minimumFractionDigits: style === 'erp3' ? 3 : 2, maximumFractionDigits: 3 })
  if (style === 'pad' && Number.isInteger(n) && n < 10) return `0${n}`
  return Number.isInteger(n) && n >= 1000 ? n.toLocaleString('en-US') : String(n)
}

const NUMBER_WORD = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve']

function itemCode(r: Rng, style: number): string {
  switch (style) {
    case 0:
      return `${r.pick(['ELC', 'INS', 'MEC', 'CON', 'GEN'])}-${D(r, 5)}`
    case 1:
      return `10${D(r, 8)}`
    case 2:
      return `${r.pick(['E', 'I', 'M'])}${D(r, 2)}-${D(r, 3)}-${D(r, 4)}`
    default:
      return `${r.int(100000, 899999)}`
  }
}

function rfqNumber(r: Rng, c: Industrial): string {
  return r.pick([`RFQ-${c.code}-${r.int(2025, 2026)}-${String(r.int(1, 999)).padStart(4, '0')}`, `${r.int(4000000000, 4000999999)}`, `${c.code}/PUR/RFQ/${r.int(100, 2999)}`, `RFQ${r.int(26000, 26999)}`, `PE-${r.int(10000, 99999)}`])
}

// ------------------------------------------------------------------------------------------------ 29. ERP RFQ form

interface Col {
  head: string
  /** What the cell holds. */
  kind: 'sno' | 'code' | 'desc' | 'spec' | 'make' | 'part' | 'makemodel' | 'uom' | 'qty' | 'date' | 'remarks' | 'dept'
  w: number
  al: 'l' | 'r' | 'c'
}

const LAYOUTS: Col[][] = [
  [
    { head: 'S.No', kind: 'sno', w: 0.06, al: 'c' },
    { head: 'Item Code', kind: 'code', w: 0.13, al: 'l' },
    { head: 'Description', kind: 'desc', w: 0.47, al: 'l' },
    { head: 'UOM', kind: 'uom', w: 0.07, al: 'c' },
    { head: 'Qty', kind: 'qty', w: 0.1, al: 'r' },
    { head: 'Required Date', kind: 'date', w: 0.13, al: 'c' },
  ],
  [
    { head: 'Sr.#', kind: 'sno', w: 0.05, al: 'c' },
    { head: 'Material No.', kind: 'code', w: 0.12, al: 'l' },
    { head: 'Material Description', kind: 'desc', w: 0.33, al: 'l' },
    { head: 'Make', kind: 'make', w: 0.1, al: 'l' },
    { head: 'Part No.', kind: 'part', w: 0.17, al: 'l' },
    { head: 'Unit', kind: 'uom', w: 0.06, al: 'c' },
    { head: 'Req. Qty', kind: 'qty', w: 0.08, al: 'r' },
    { head: 'Need By', kind: 'date', w: 0.1, al: 'c' },
  ],
  [
    { head: 'Line', kind: 'sno', w: 0.06, al: 'c' },
    { head: 'Item #', kind: 'code', w: 0.13, al: 'l' },
    { head: 'Item Description / Specification', kind: 'desc', w: 0.43, al: 'l' },
    { head: 'U/M', kind: 'uom', w: 0.06, al: 'c' },
    { head: 'Quantity', kind: 'qty', w: 0.1, al: 'r' },
    { head: 'Del. Date', kind: 'date', w: 0.11, al: 'c' },
    { head: 'Remarks', kind: 'remarks', w: 0.11, al: 'l' },
  ],
  [
    { head: 'S.No', kind: 'sno', w: 0.05, al: 'c' },
    { head: 'Item Code', kind: 'code', w: 0.12, al: 'l' },
    { head: 'Description', kind: 'desc', w: 0.43, al: 'l' },
    { head: 'Dept', kind: 'dept', w: 0.08, al: 'c' },
    { head: 'UOM', kind: 'uom', w: 0.07, al: 'c' },
    { head: 'Qty', kind: 'qty', w: 0.1, al: 'r' },
    { head: 'Required Date', kind: 'date', w: 0.13, al: 'c' },
  ],
  [
    { head: 'Item', kind: 'sno', w: 0.05, al: 'c' },
    { head: 'Description', kind: 'desc', w: 0.25, al: 'l' },
    { head: 'Specification', kind: 'spec', w: 0.25, al: 'l' },
    { head: 'Make/Model', kind: 'makemodel', w: 0.17, al: 'l' },
    { head: 'Qty', kind: 'qty', w: 0.08, al: 'r' },
    { head: 'UOM', kind: 'uom', w: 0.07, al: 'c' },
    { head: 'Date Required', kind: 'date', w: 0.13, al: 'c' },
  ],
]

const TERMS_ERP = [
  'Quotation must be valid for at least 60 days.',
  'Prices must be quoted inclusive of all taxes; GST shall be shown separately.',
  'Delivery period and country of origin must be mentioned.',
  'Payment: 30 days after receipt of material and invoice.',
  'Partial quotations will not be accepted.',
  'Original manufacturer test certificates are required with supply.',
  'The company reserves the right to accept or reject any quotation.',
  'Material must be delivered at our plant stores.',
]

export const erpRfqForm: EnquiryTemplate = r => {
  const c = industrial(r)
  const n = r.int(3, 30)
  const its = items(r, n)
  const layout = r.pick(LAYOUTS)
  const has = (k: Col['kind']) => layout.some(x => x.kind === k)
  const rfq = rfqNumber(r, c)
  const docDate = dateAfter(-r.int(0, 3))
  const due = dateAfter(r.int(5, 21))
  const dateStyle = r.pick([0, 1, 2, 8])
  const qStyle = r.pick(['erp3', 'erp3', 'erp2', 'plain', 'pad'] as const)
  const reg = r.pick(['erp', 'caps', 'plain'] as const)
  const codeStyle = r.int(0, 3)
  const title = r.pick(['REQUEST FOR QUOTATION', 'RFQ', 'PURCHASE ENQUIRY', 'QUOTATION REQUEST', 'REQUEST FOR QUOTATION (RFQ)'])
  const tens = r.chance(0.25)
  const truth: ItemTruth[] = []
  const rows = its.map((it, i) => {
    const unit = writeUnit(r, it.fam, 'caps')
    const base = reg === 'erp' ? it.erp : reg === 'caps' ? it.caps : it.plain
    // With no Make or Part No column, the part number and the make are written into the description.
    const inline = !has('part') && !has('makemodel') && it.part ? `${base} ${r.pick(['P/N:', 'MODEL:', 'Part No.', 'CAT NO'])} ${it.part}${it.brand ? ` MAKE: ${it.brand.toUpperCase()}` : ''}` : base
    const spec = has('spec') ? (reg === 'plain' ? it.spec : it.spec.toUpperCase()) : ''
    const descCell = has('spec') ? (reg === 'plain' ? it.noun : it.noun.toUpperCase()) : inline
    const makeModel = it.part ? `${it.brand ?? ''} ${it.part}`.trim() : it.brand ?? ''
    const want = [descCell, spec, has('part') ? it.part ?? '' : '', has('make') || has('makemodel') ? (has('makemodel') ? makeModel : it.brand ?? '') : ''].filter(Boolean).join(' ')
    truth.push({ description: want, qty: it.qty, unit, part: it.part ?? undefined })
    return layout.map(col => {
      switch (col.kind) {
        case 'sno':
          return tens ? String((i + 1) * 10) : String(i + 1)
        case 'code':
          return itemCode(r, codeStyle)
        case 'desc':
          return descCell
        case 'spec':
          return spec
        case 'make':
          return it.brand ?? ''
        case 'part':
          return it.part ?? ''
        case 'makemodel':
          return makeModel
        case 'uom':
          return unit
        case 'qty':
          return qtyText(it.qty, qStyle)
        case 'date':
          return writeDate(r, dateAfter(r.int(25, 90)), dateStyle)
        case 'remarks':
          return r.pick(['', '', 'Urgent', 'Original only', 'For shutdown', 'Same as sample'])
        case 'dept':
          return r.pick(['E&I', 'MECH', 'ELEC', 'UTIL', 'PROD'])
      }
    })
  })
  const rowsPerPage = n > 10 ? r.int(7, 12) : n
  const pages: string[][][] = []
  for (let i = 0; i < rows.length; i += rowsPerPage) pages.push(rows.slice(i, i + rowsPerPage))
  const m = pages.length
  const dueText = writeDate(r, due, dateStyle)
  const box: Block[] = r.pick([
    () => [
      { k: 'pair', left: `RFQ No: ${rfq}`, right: `RFQ Date: ${writeDate(r, docDate, dateStyle)}` },
      { k: 'pair', left: `Vendor: ${r.pick(['V-', 'S-', ''])}${r.int(10000, 29999)} Q-TECH ENGINEERING`, right: `${r.pick(['Closing Date:', 'Due Date:', 'Last Date of Submission:', 'Quotation Due On:'])} ${dueText}` },
      { k: 'pair', left: `Buyer: ${c.person}`, right: `Currency: ${r.pick(['PKR', 'PKR', 'USD'])}` },
    ],
    () => [
      {
        k: 'table',
        head: null,
        rows: [
          ['RFQ No.', rfq, 'RFQ Date', writeDate(r, docDate, dateStyle)],
          ['Supplier', 'Q-Tech Engineering', r.pick(['Closing Date', 'Due Date', 'Submission Deadline']), dueText],
          ['Supplier Code', `${r.int(200000, 299999)}`, 'Buyer', c.person],
          ['Delivery At', `${c.city} Plant Stores`, 'Payment Terms', r.pick(['30 Days Credit', 'Advance 30%, Balance on Delivery', '45 Days'])],
        ],
        widths: [0.16, 0.34, 0.18, 0.32],
        align: ['l', 'l', 'l', 'l'],
        ruled: true,
        descCol: 1,
      },
    ],
    () => [
      { k: 'text', text: `RFQ #: ${rfq}` },
      { k: 'text', text: `Date: ${writeDate(r, docDate, dateStyle)}` },
      { k: 'text', text: `To: M/s Q-Tech Engineering, Lahore` },
      { k: 'text', text: `Quotation Due Date: ${dueText}` },
    ],
  ] as Array<() => Block[]>)()
  const head = layout.map(x => x.head)
  const widths = layout.map(x => x.w)
  const align = layout.map(x => x.al)
  const descCol = layout.findIndex(x => x.kind === 'desc')
  const footer = (p: number): Block[] => {
    const sign: Block[] = r.pick([
      () => [{ k: 'text', text: 'Prepared By: ____________     Checked By: ____________     Approved By: ____________', size: 8 }],
      () => [{ k: 'table', head: null, rows: [['Prepared By', 'Verified By', 'Approved By'], [c.person, 'Store Incharge', 'GM Procurement']], widths: [0.33, 0.33, 0.34], align: ['c', 'c', 'c'], ruled: false, descCol: 0, size: 8 }],
      () => [
        { k: 'pair', left: 'Requested By: ______________', right: 'HOD Signature: ______________' },
        { k: 'text', text: 'This is a computer generated document.', size: 7 },
      ],
    ] as Array<() => Block[]>)()
    return [{ k: 'gap' }, ...sign, { k: 'text', text: `Page ${p} of ${m}`, align: 'right', size: 7 }]
  }
  const blocks: Block[] = [{ k: 'text', text: title, bold: true, size: 12, align: 'center' }, { k: 'gap' }, ...box, { k: 'gap' }]
  blocks.push({ k: 'text', text: r.pick(['Please quote your best prices for the following items:', 'You are requested to submit your quotation for the items listed below.', 'Kindly quote the following material on or before the closing date.']) })
  pages.forEach((rs, p) => {
    if (p > 0) {
      blocks.push({ k: 'pagebreak' })
      blocks.push({ k: 'text', text: `${title} - ${rfq} (Continued)`, bold: true, size: 9 })
    }
    // The header row is printed on every page (most ERP reports), or only on the first.
    const repeat = p === 0 || r.chance(0.85)
    blocks.push({ k: 'table', head: repeat ? head : null, rows: rs, widths, align, ruled: true, descCol, size: 8 })
    if (p < m - 1) blocks.push(...footer(p + 1))
  })
  if (r.chance(0.5)) blocks.push({ k: 'text', text: `Total No. of Items: ${n}` })
  blocks.push({ k: 'gap' }, { k: 'text', text: r.pick(['Terms & Conditions:', 'TERMS AND CONDITIONS', 'Terms and Conditions']), bold: true })
  r.sample(TERMS_ERP, r.int(3, 6)).forEach((t, i) => blocks.push({ k: 'text', text: `${i + 1}. ${t}` }))
  if (r.chance(0.5)) blocks.push({ k: 'text', text: `${r.int(7, 9)}. Required delivery at site by ${writeDate(r, dateAfter(r.int(30, 75)), dateStyle)}.` })
  blocks.push(...footer(m))
  const letterhead: Block[] = [
    { k: 'text', text: c.name.toUpperCase(), bold: true, size: 13, align: 'center' },
    { k: 'text', text: c.address, size: 8, align: 'center' },
    { k: 'text', text: `NTN: ${r.int(1000000, 9999999)}-${r.int(0, 9)}  STRN: ${r.int(10, 99)}-${r.int(10, 99)}-${r.int(1000, 9999)}-${r.int(100, 999)}-${r.int(10, 99)}`, size: 7, align: 'center' },
    { k: 'text', text: `Tel: ${c.landline}  Email: ${c.email}`, size: 8, align: 'center' },
    { k: 'gap' },
  ]
  const doc: Doc = { look: 'paper', blocks, page: { font: r.pick(['helvetica', 'helvetica', 'courier', 'times']), size: r.pick([8.5, 9]), letterhead, landscape: layout.length >= 8 && r.chance(0.5) } }
  // The letterhead is printed on page 1 only by some systems (the PDF repeats doc.page.letterhead on every page).
  if (r.chance(0.3)) {
    doc.blocks = [...letterhead, ...blocks]
    delete doc.page!.letterhead
  }
  return { doc, truth: { items: truth, ref: rfq, due: due.iso, company: c.name, domain: c.domain }, media: ['pdf', 'scan', 'image'] }
}

// ------------------------------------------------------------------------------------------------ 30. Word letter

const TOPIC = ['Instrumentation Spares', 'Electrical Items', 'PLC and Drive Spares', 'Consumables', 'Annual Shutdown Material', 'Process Control Items', 'Maintenance Spares']

const LETTER_TERMS = [
  'Rates should be inclusive of all taxes.',
  'Delivery period must be clearly mentioned.',
  'Validity of offer should not be less than 30 days.',
  'Payment will be made within 30 days after delivery.',
  'Please mention make and country of origin of each item.',
  'Warranty / guarantee of the items should be mentioned.',
  'Incomplete quotations will not be considered.',
]

function unitWord(r: Rng, fam: string): string {
  return writeUnit(r, fam, r.pick(['title', 'title', 'caps', 'lower'] as const))
}

/** "2 Nos", "02 Nos.", "2 (Two) Nos", "12.5 Mtrs", "1,000 Nos": a quantity as a letter writes it. */
function letterQty(r: Rng, q: number, unit: string): string {
  const n = Number.isInteger(q) && q <= 12 && r.chance(0.25) ? `${q} (${NUMBER_WORD[q]})` : qtyText(q, r.pick(['plain', 'plain', 'pad'] as const))
  return `${n} ${unit}${r.chance(0.2) && /^[A-Za-z]+$/.test(unit) ? '.' : ''}`
}

export const letterRfq: EnquiryTemplate = r => {
  const c = industrial(r)
  const style = r.pick(['paren', 'dot', 'alpha', 'roman', 'sublines', 'leaders', 'table', 'itemno', 'inline'] as const)
  const n = style === 'inline' ? r.int(1, 3) : r.int(1, 12)
  const its = items(r, n)
  const ref = r.pick([`${c.code}/PUR/${r.int(2025, 2026)}/${r.int(100, 999)}`, `${c.code}-ENQ-${r.int(1000, 9999)}`, `No. ${c.code}/${r.pick(['EI', 'MM', 'PROC'])}/${r.int(10, 99)}/${r.int(2025, 2026)}`, `PR-${r.int(10000, 99999)}`])
  const refValue = ref.replace(/^No\.\s+/, '')
  const date = dateAfter(-r.int(0, 3))
  const due = dateAfter(r.int(4, 20))
  const dueText = writeDate(r, due)
  const truth: ItemTruth[] = []
  const blocks: Block[] = []
  if (r.chance(0.5)) blocks.push({ k: 'pair', left: `Ref: ${ref}`, right: `Date: ${writeDate(r, date)}` })
  else blocks.push({ k: 'text', text: `${r.pick(['Ref:', 'Our Ref:', 'Ref. No.'])} ${refValue}` }, { k: 'text', text: `${r.pick(['Date:', 'Dated:'])} ${writeDate(r, date)}` })
  blocks.push({ k: 'gap' }, { k: 'text', text: 'To,' }, { k: 'text', text: r.pick(['The Sales Manager,', 'The Manager Sales,', 'The Proprietor,']) }, { k: 'text', text: r.pick(['M/s Q-Tech Engineering,', 'Messrs Q-Tech Engineering,', 'Q-Tech Engineering,']) })
  if (r.chance(0.5)) blocks.push({ k: 'text', text: r.pick(['Office 12, Second Floor, Example Plaza,', 'Shop 4, Example Market,']) })
  blocks.push({ k: 'text', text: 'Lahore.' }, { k: 'gap' })
  blocks.push({ k: 'text', text: `${r.pick(['Subject:', 'SUBJECT:', 'Sub:'])} ${r.pick(['REQUEST FOR QUOTATION', 'Request for Quotation', 'Invitation to Quote', 'Enquiry'])} ${r.pick(['-', 'for', '–'])} ${r.pick(TOPIC)}`, bold: true })
  blocks.push({ k: 'gap' }, { k: 'text', text: r.pick(['Dear Sir,', 'Dear Sir/Madam,', 'Respected Sir,', 'Dear Mr. Wasif,']) }, { k: 'gap' })
  const dueInOpening = r.chance(0.4)
  const opening = r.pick([
    'Please quote for the following:',
    'We are pleased to invite your quotation for the supply of the following items:',
    'Please quote your most competitive rates for the following material required for our plant:',
    'You are requested to submit your best offer for the items mentioned below.',
    'With reference to the above subject, please quote for the following:',
  ])
  const dueSentence = r.pick([`Your quotation should reach the undersigned latest by ${dueText}.`, `The last date for submission of quotation is ${dueText}.`, `Please send your offer by ${dueText}.`, `Quotations must reach this office on or before ${dueText}.`])
  const unitOf = (it: Item) => unitWord(r, it.fam)
  const descOf = (it: Item, withPart: boolean) => (withPart && it.part ? `${it.plain}${r.chance(0.5) ? `, Model: ${it.part}` : ` ${it.part}`}` : it.plain)
  if (style === 'inline') {
    const parts = its.map((it, i) => {
      const unit = unitOf(it)
      const desc = descOf(it, true)
      truth.push({ description: desc, qty: it.qty, unit, part: it.part ?? undefined })
      return `${i + 1}) ${desc} - ${letterQty(r, it.qty, unit)}`
    })
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
    blocks.push({ k: 'text', text: `Please quote for the following: ${list}.` })
    if (dueInOpening) blocks.push({ k: 'text', text: dueSentence })
  } else {
    blocks.push({ k: 'text', text: dueInOpening ? `${opening.replace(/:$/, '.')} ${dueSentence}` : opening })
    blocks.push({ k: 'gap' })
    if (style === 'table') {
      const withMake = r.chance(0.5)
      const head = withMake ? ['S. No.', 'Item Description', 'Make', 'Quantity'] : ['Sr. No.', 'Description', 'Qty', 'Unit']
      const rows = its.map((it, i) => {
        const unit = unitOf(it)
        const desc = descOf(it, true)
        truth.push({ description: withMake && it.brand ? `${desc} ${it.brand}` : desc, qty: it.qty, unit, part: it.part ?? undefined })
        return withMake ? [`${i + 1}.`, desc, it.brand ?? '-', letterQty(r, it.qty, unit)] : [`${i + 1}`, desc, qtyText(it.qty, 'plain'), unit]
      })
      blocks.push({ k: 'table', head, rows, widths: withMake ? [0.09, 0.55, 0.15, 0.17] : [0.1, 0.62, 0.12, 0.12], align: withMake ? ['c', 'l', 'l', 'c'] : ['c', 'l', 'r', 'c'], ruled: true, descCol: 1 })
    } else {
      its.forEach((it, i) => {
        const unit = unitOf(it)
        const marker =
          style === 'paren' ? `${i + 1})` : style === 'dot' ? `${i + 1}.` : style === 'alpha' ? `(${'abcdefghijkl'[i]})` : style === 'roman' ? `${['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'][i]}.` : style === 'itemno' ? `Item No. ${i + 1}:` : `${i + 1}.`
        const q = letterQty(r, it.qty, unit)
        if (style === 'sublines' || style === 'itemno') {
          // The item, then its make, model and quantity on lines of their own, indented under it.
          blocks.push({ k: 'text', text: `${marker} ${it.plain}` })
          const want = [it.plain]
          if (it.brand) {
            blocks.push({ k: 'text', text: `Make: ${it.brand}`, indent: 6 })
            want.push(it.brand)
          }
          if (it.part) {
            blocks.push({ k: 'text', text: `${r.pick(['Model:', 'Part No.:', 'Model No:'])} ${it.part}`, indent: 6 })
            want.push(it.part)
          }
          blocks.push({ k: 'text', text: `${r.pick(['Qty:', 'Quantity:', 'Quantity Required:'])} ${q}`, indent: 6 })
          truth.push({ description: want.join(' '), qty: it.qty, unit, part: it.part ?? undefined })
          return
        }
        const desc = descOf(it, true)
        truth.push({ description: desc, qty: it.qty, unit, part: it.part ?? undefined })
        if (style === 'leaders') blocks.push({ k: 'text', text: `${i + 1}. ${desc} ${'.'.repeat(r.int(6, 14))} ${q}` })
        else if (style === 'alpha' && r.chance(0.5)) blocks.push({ k: 'text', text: `${marker} ${desc} (Qty: ${q})` })
        else blocks.push({ k: 'text', text: `${marker} ${desc} ${r.pick(['-', '–', '', ':'])} ${q}`.replace(/\s+/g, ' ') })
      })
    }
  }
  if (n > 7 && style !== 'inline' && r.chance(0.6)) blocks.push({ k: 'text', text: 'Contd. on next page', align: 'right', size: 8 }, { k: 'pagebreak' })
  blocks.push({ k: 'gap' })
  // The terms after the items, numbered like them: with a heading, or after a sentence that asks for them.
  const terms = r.sample(LETTER_TERMS, r.int(2, 5))
  const termsHead = r.pick(['Terms and Conditions:', 'Please note the following:', 'Kindly also mention the following in your quotation:', 'Note:', ''])
  if (termsHead) blocks.push({ k: 'text', text: termsHead, bold: termsHead.startsWith('Terms') })
  terms.forEach((t, i) => blocks.push({ k: 'text', text: `${i + 1}. ${t}` }))
  if (!dueInOpening) blocks.push({ k: 'gap' }, { k: 'text', text: dueSentence })
  if (r.chance(0.4)) blocks.push({ k: 'text', text: `The material is required at our ${c.city} plant by ${writeDate(r, dateAfter(r.int(30, 60)))}.` })
  blocks.push(
    { k: 'gap' },
    { k: 'text', text: r.pick(['Thanking you,', 'Thanking you in anticipation,', 'Yours faithfully,', 'Yours sincerely,', 'Regards,']) },
    { k: 'gap' },
  )
  if (r.chance(0.3)) blocks.push({ k: 'text', text: '(Signature)' })
  blocks.push({ k: 'text', text: c.person }, { k: 'text', text: c.title })
  if (r.chance(0.5)) blocks.push({ k: 'text', text: c.dept })
  blocks.push({ k: 'text', text: `For ${c.name}` })
  if (r.chance(0.5)) blocks.push({ k: 'text', text: `Cell: ${c.phone}` })
  if (r.chance(0.3)) blocks.push({ k: 'gap' }, { k: 'text', text: 'cc: GM Works / File' })
  const letterhead: Block[] = [
    { k: 'text', text: c.name, bold: true, size: 15, align: 'center' },
    { k: 'text', text: `${c.address} | Ph: ${c.landline} | ${c.email}`, size: 8, align: 'center' },
    { k: 'gap' },
  ]
  const multi = n > 6
  const doc: Doc = { look: 'paper', blocks, page: { font: r.pick(['times', 'helvetica', 'times']), size: r.pick([10, 11, 11.5]), letterhead, footer: multi && r.chance(0.6) ? r.pick(['Page {n} of {m}', 'Page {n}']) : undefined } }
  return { doc, truth: { items: truth, ref: refValue, due: due.iso, company: c.name }, media: ['text', 'pdf', 'scan', 'image'] }
}

// (Weight 3: a batch triples its newest generation's weight, so 29 and 30 come out about even.)
export const ENQUIRY_TEMPLATES_GEN29 = [{ shape: 'erp_rfq_form', make: erpRfqForm, weight: 3 }]
export const ENQUIRY_TEMPLATES_GEN30 = [{ shape: 'letter_rfq', make: letterRfq, weight: 1 }]
