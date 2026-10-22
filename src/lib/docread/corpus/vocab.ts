// Fictional vocabulary for the reader's corpus: customers, people, suppliers, brands and parts. Every company, person, brand,
// address, phone number and part number is invented (part numbers only follow the SHAPES real catalogues use: "6ES7953-8LM31-0AA0",
// "FX3U-64M", "P830B4417"). Nothing here comes from a real customer file.

import type { Rng } from './rng'

// ------------------------------------------------------------------------------------------------ customers

const PLACE = ['Indus', 'Ravi', 'Chenab', 'Jhelum', 'Margalla', 'Karakoram', 'Sutlej', 'Kohsar', 'Thar', 'Mehran', 'Potohar', 'Swat', 'Kaghan', 'Bolan', 'Hingol', 'Shalimar', 'Neelum', 'Gilgit', 'Kirthar', 'Rohtas', 'Sialkot Valley', 'Hunza', 'Makran', 'Tarbela']
const TRADE = [
  ['Weaving Mills', 'textile'],
  ['Spinning Mills', 'textile'],
  ['Textile Mills', 'textile'],
  ['Denim Mills', 'textile'],
  ['Processing Industries', 'textile'],
  ['Agro Foods', 'food'],
  ['Dairies', 'food'],
  ['Beverages', 'food'],
  ['Sugar Mills', 'food'],
  ['Flour Mills', 'food'],
  ['Chemicals', 'chemical'],
  ['Petrochem', 'chemical'],
  ['Fertilizers', 'chemical'],
  ['Paints', 'chemical'],
  ['Pharma', 'chemical'],
  ['Cement', 'other'],
  ['Paper & Board', 'other'],
  ['Power Generation', 'other'],
  ['Glass Works', 'other'],
  ['Steel Industries', 'other'],
] as const
const SUFFIX = ['Ltd', 'Limited', '(Pvt) Ltd', '(Private) Limited', 'Pvt. Ltd.', 'Industries Ltd', 'Ltd.']
const CITY = ['Faisalabad', 'Lahore', 'Karachi', 'Multan', 'Sheikhupura', 'Kasur', 'Hattar', 'Gujranwala', 'Sialkot', 'Rawalpindi', 'Hyderabad', 'Raiwind']
const STREET = ['Industrial Estate', 'Sargodha Road', 'Jaranwala Road', 'Korangi Industrial Area', 'SITE Area', 'Sundar Industrial Estate', 'Multan Road', 'Ferozepur Road', 'Kot Lakhpat', 'Lahore-Sheikhupura Road', 'Bund Road', 'GT Road']

const FIRST = ['Asad', 'Imran', 'Bilal', 'Kamran', 'Shahid', 'Faisal', 'Usman', 'Hamza', 'Zeeshan', 'Naveed', 'Adeel', 'Waqas', 'Sana', 'Ayesha', 'Fahad', 'Junaid', 'Tariq', 'Rizwan', 'Saad', 'Hira', 'Mehwish', 'Nadeem', 'Owais', 'Salman', 'Yasir', 'Atif', 'Sohail', 'Qasim', 'Danish', 'Farhan']
const LAST = ['Mehmood', 'Qureshi', 'Iqbal', 'Raza', 'Malik', 'Butt', 'Sheikh', 'Chaudhry', 'Akhtar', 'Siddiqui', 'Hashmi', 'Rana', 'Javed', 'Aslam', 'Anwar', 'Bhatti', 'Gondal', 'Khokhar', 'Mirza', 'Abbasi', 'Rehman', 'Zafar', 'Haider', 'Nawaz', 'Saleem']
const TITLE = ['Purchase Officer', 'Senior Engineer Procurement', 'Manager Purchase', 'Assistant Manager Supply Chain', 'Instrument Engineer', 'Store Incharge', 'Procurement Executive', 'Deputy Manager Electrical', 'Buyer', 'Purchase Executive', 'Maintenance Engineer', 'Senior Officer Procurement']

export interface Customer {
  name: string
  short: string
  domain: string
  city: string
  address: string
  industry: string
  person: string
  title: string
  email: string
  phone: string
  landline: string
  /** The prefix the customer's own references use ("IVW"). */
  code: string
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, '')

export function customer(r: Rng): Customer {
  const place = r.pick(PLACE)
  const [trade, industry] = r.pick(TRADE)
  const name = `${place} ${trade} ${r.pick(trade.includes('Industries') ? SUFFIX.filter(x => !x.includes('Industries')) : SUFFIX)}`
  const words = `${place} ${trade}`.split(/[\s&]+/).filter(Boolean)
  const code = words.map(w => w[0]).join('').toUpperCase().slice(0, 4)
  const tld = r.pick(['example.pk', 'example.com.pk', 'example.com', 'example'])
  const domain = r.chance(0.5) ? `${slug(place)}${slug(trade).slice(0, 6)}.${tld}` : `${code.toLowerCase()}${r.pick(['group', 'mills', 'pk', 'ind', ''])}.${tld}`
  const first = r.pick(FIRST)
  const last = r.pick(LAST)
  const city = r.pick(CITY)
  const local = r.pick([`${first}.${last}`, `${first[0]}${last}`, `${first}`, `purchase`, `procurement`, `${first}${r.int(1, 99)}`]).toLowerCase()
  return {
    name,
    short: place,
    domain,
    city,
    address: `Plot ${r.int(2, 180)}-${r.pick(['A', 'B', 'C', 'D'])}, ${r.pick(STREET)}, ${city}`,
    industry,
    person: `${first} ${last}`,
    title: r.pick(TITLE),
    email: `${local}@${domain}`,
    phone: `+92 3${r.int(0, 4)}${r.int(0, 9)} ${r.int(1000000, 9999999)}`,
    landline: `+92 ${r.pick(['41', '42', '21', '61', '51'])} ${r.int(3000000, 8999999)}`,
    code,
  }
}

// ------------------------------------------------------------------------------------------------ suppliers (quotes)

const SUP_A = ['Zhejiang', 'Shenzhen', 'Ningbo', 'Wuxi', 'Dongguan', 'Xiamen', 'Suzhou', 'Foshan', 'Changzhou', 'Jiangyin']
const SUP_B = ['Huaxin', 'Longtai', 'Ruida', 'Jinpeng', 'Haoyu', 'Kaiyuan', 'Mingda', 'Boxin', 'Tianrui', 'Hengli']
const SUP_C = ['Automation Co., Ltd.', 'Electric Co., Ltd.', 'Instrument Technology Co., Ltd.', 'Industrial Supply Co., Ltd.', 'Trading Co., Ltd.']
const SUP_W = ['Rhein', 'Nordwerk', 'Alpen', 'Baltic', 'Elbe', 'Danube', 'Weser']
const SUP_D = ['Gulf Star', 'Al Noor', 'Desert Falcon', 'Creek Side', 'Jebel', 'Emirates Bridge']
const SUP_P = ['Al-Madina', 'Crescent', 'Shan', 'Star', 'United', 'Fazal']

export interface Supplier {
  name: string
  person: string
  email: string
  phone: string
  currency: 'USD' | 'EUR' | 'CNY' | 'AED' | 'PKR'
  region: 'china' | 'europe' | 'gulf' | 'local'
  city: string
}

export function supplier(r: Rng, region?: Supplier['region']): Supplier {
  const reg = region ?? r.pick(['china', 'china', 'europe', 'gulf', 'local'] as const)
  const first = r.pick(['Lily', 'Kevin', 'Grace', 'Tony', 'Cherry', 'Jason', 'Amy', 'Leo', 'Hannah', 'Markus', 'Stefan', 'Omar', 'Rashid', 'Faisal', 'Arif'])
  let name: string
  let city: string
  let currency: Supplier['currency']
  if (reg === 'china') {
    city = r.pick(SUP_A)
    name = `${city} ${r.pick(SUP_B)} ${r.pick(SUP_C)}`
    currency = r.pick(['USD', 'USD', 'CNY'] as const)
  } else if (reg === 'europe') {
    city = r.pick(['Hamburg', 'Bremen', 'Stuttgart', 'Rotterdam', 'Milano'])
    name = `${r.pick(SUP_W)} ${r.pick(['Industrietechnik GmbH', 'Automation GmbH', 'Process Controls B.V.', 'Componenti S.r.l.'])}`
    currency = r.pick(['EUR', 'EUR', 'USD'] as const)
  } else if (reg === 'gulf') {
    city = r.pick(['Dubai', 'Sharjah', 'Ajman'])
    name = `${r.pick(SUP_D)} ${r.pick(['General Trading LLC', 'Electromechanical LLC', 'Industrial Supplies FZE'])}`
    currency = r.pick(['AED', 'USD'] as const)
  } else {
    city = r.pick(['Lahore', 'Karachi'])
    name = `${r.pick(SUP_P)} ${r.pick(['Traders', 'Electric Store', 'Engineering Services', 'Enterprises'])}`
    currency = 'PKR'
  }
  const dom = `${slug(name.split(' ').slice(0, 2).join(''))}.example`
  return { name, person: first, email: `${first.toLowerCase()}@${dom}`, phone: `+${r.pick(['86 571', '49 40', '971 4', '92 42'])} ${r.int(1000000, 9999999)}`, currency, region: reg, city }
}

// ------------------------------------------------------------------------------------------------ parts

const BRAND = ['Vextron', 'Kalmar', 'Hydrovia', 'Sentrik', 'Polaron', 'Teknova', 'Amerix', 'Zentar', 'Delmont', 'Orvik', 'Brixen', 'Calvex', 'Norsk Elektro', 'Tamura-Kei', 'Ostwind', 'Lumenta']

const D = (r: Rng, n: number) => Array.from({ length: n }, () => r.int(0, 9)).join('')
const L = (r: Rng, n: number) => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPRSTUVWXYZ'[r.int(0, 22)]).join('')

/** Part-number shapes seen in instrumentation and electrical catalogues; the characters are random. */
const PART_SHAPES: Array<(r: Rng) => string> = [
  r => `6ES7${D(r, 3)}-${D(r, 1)}${L(r, 2)}${D(r, 2)}-0${L(r, 2)}0`,
  r => `3RT${D(r, 4)}-${D(r, 1)}${L(r, 2)}${D(r, 2)}`,
  r => `FX${r.int(1, 5)}U-${r.pick([16, 32, 48, 64, 80, 128])}M${r.pick(['', 'R', 'T', 'R/ES', 'T/ESS'])}`,
  r => `P${D(r, 3)}A${D(r, 4)}`,
  r => `E${r.int(2, 3)}${L(r, 1)}-${L(r, 1)}${D(r, 2)}`,
  r => `${L(r, 2)}${D(r, 3)}-${D(r, 2)}${L(r, 1)}`,
  r => `LC1D${D(r, 2)}${L(r, 1)}${D(r, 1)}`,
  r => `PMC${D(r, 2)}-${L(r, 3)}${D(r, 1)}${L(r, 1)}${D(r, 1)}`,
  r => `1SVR${D(r, 6)}R${D(r, 4)}`,
  r => `${D(r, 3)}B${D(r, 4)}`,
  r => `${L(r, 3)}-${D(r, 4)}-${L(r, 1)}${D(r, 1)}`,
  r => `${L(r, 1)}${D(r, 4)}${L(r, 2)}`,
  r => `G${r.int(2, 9)}${L(r, 2)}-${D(r, 3)}`,
  r => `${L(r, 2)}-${D(r, 2)}${L(r, 1)}-${D(r, 3)}`,
]

export function partNumber(r: Rng): string {
  return r.pick(PART_SHAPES)(r)
}

export interface Part {
  /** Natural description ("Pressure transmitter 0-16 bar, 4-20mA, 1/2\" NPT"). */
  plain: string
  /** Capitals, as an Outlook RFQ or a store requisition writes it ("PRESSURE TRANSMITTER 0-16 BAR 4-20MA"). */
  caps: string
  /** ERP master-data style ("TRANSMITTER,PRESSURE;0-25BAR,4-20MA"). */
  erp: string
  /** Part or model number, when the item names one. */
  part: string | null
  brand: string | null
  /** Units a customer would buy this in. */
  units: string[]
  /** A quantity that makes sense for it. */
  qty: (r: Rng) => number
}

interface Family {
  noun: string
  erpNoun: string
  specs: Array<(r: Rng) => string>
  units: string[]
  qty: (r: Rng) => number
  part: number
}

const few = (r: Rng) => r.pick([1, 1, 2, 2, 2, 3, 4, 4, 5, 6, 8, 10, 12])
const many = (r: Rng) => r.pick([10, 12, 20, 25, 50, 100, 150, 200, 500, 1000])
const length = (r: Rng) => r.pick([25, 50, 100, 150, 200, 250, 300, 500, 1000])
const weight = (r: Rng) => r.pick([2, 5, 10, 20, 25, 2.5, 7.5, 50])

const FAMILIES: Family[] = [
  { noun: 'Pressure transmitter', erpNoun: 'TRANSMITTER,PRESSURE', specs: [r => `0-${r.pick([4, 10, 16, 25, 40, 60])} bar`, () => '4-20mA', r => r.pick(['1/2" NPT', 'G1/2', 'with HART'])], units: ['Nos', 'EA', 'PCS', 'No'], qty: few, part: 0.6 },
  { noun: 'Pressure gauge', erpNoun: 'GAUGE,PRESSURE', specs: [r => `0-${r.pick([6, 10, 16, 25, 40])} bar`, r => `${r.pick([63, 100, 150])}mm dial`, r => r.pick(['glycerine filled', 'SS304 case', 'bottom entry'])], units: ['Nos', 'EA', 'PCS'], qty: few, part: 0.3 },
  { noun: 'Temperature transmitter', erpNoun: 'TRANSMITTER,TEMPERATURE', specs: [r => `PT100 ${r.pick(['0-150', '0-200', '0-400'])} C`, () => 'head mount', () => '4-20mA'], units: ['Nos', 'EA', 'No'], qty: few, part: 0.6 },
  { noun: 'Thermocouple', erpNoun: 'THERMOCOUPLE', specs: [r => `type ${r.pick(['K', 'J', 'T'])}`, r => `${r.pick([150, 300, 500])}mm`, () => 'with head'], units: ['Nos', 'PCS', 'EA'], qty: few, part: 0.2 },
  { noun: 'Proximity sensor', erpNoun: 'SENSOR,PROXIMITY', specs: [r => `M${r.pick([8, 12, 18, 30])}`, r => r.pick(['PNP NO', 'NPN NC', 'PNP NO+NC']), r => `${r.pick([2, 4, 5, 8, 10])}mm`], units: ['Nos', 'PCS', 'EA'], qty: few, part: 0.8 },
  { noun: 'Photoelectric sensor', erpNoun: 'SENSOR,PHOTOELECTRIC', specs: [r => r.pick(['diffuse', 'retro-reflective', 'through beam']), r => `${r.pick([300, 500, 1000])}mm`, () => 'PNP'], units: ['Nos', 'PCS', 'EA'], qty: few, part: 0.8 },
  { noun: 'Contactor', erpNoun: 'CONTACTOR', specs: [r => `${r.pick([9, 12, 18, 25, 32, 40])}A`, r => `${r.pick(['24VDC', '220VAC', '110VAC'])} coil`, () => '1NO+1NC'], units: ['Nos', 'EA', 'PCS'], qty: few, part: 0.8 },
  { noun: 'MCB', erpNoun: 'BREAKER,MINIATURE', specs: [r => `${r.pick([1, 2, 3, 4])} pole`, r => `${r.pick(['B', 'C', 'D'])}${r.pick([6, 10, 16, 20, 32])}`, () => '10kA'], units: ['Nos', 'PCS', 'EA'], qty: few, part: 0.5 },
  { noun: 'Safety relay', erpNoun: 'RELAY,SAFETY', specs: [() => '24VDC', r => `${r.pick([2, 3])}NO+1NC`, () => 'DIN rail'], units: ['Nos', 'EA'], qty: few, part: 0.9 },
  { noun: 'Relay', erpNoun: 'RELAY,CONTROL', specs: [r => r.pick(['24VDC', '230VAC', '12VDC']), r => `${r.pick([2, 4])} CO`, () => 'with base'], units: ['Nos', 'PCS', 'EA'], qty: many, part: 0.5 },
  { noun: 'PLC CPU', erpNoun: 'PLC,CPU', specs: [r => `${r.pick([14, 24, 40, 80])} I/O`, r => r.pick(['relay output', 'transistor output']), () => '24VDC'], units: ['Nos', 'EA', 'SET'], qty: r => r.pick([1, 1, 2]), part: 1 },
  { noun: 'Digital input module', erpNoun: 'MODULE,DIGITAL INPUT', specs: [r => `${r.pick([8, 16, 32])} DI`, () => '24VDC'], units: ['Nos', 'EA'], qty: r => r.pick([1, 2, 3, 4]), part: 1 },
  { noun: 'HMI touch panel', erpNoun: 'HMI,TOUCH PANEL', specs: [r => `${r.pick([4.3, 7, 10, 12])} inch`, () => 'Ethernet'], units: ['Nos', 'EA', 'SET'], qty: r => r.pick([1, 1, 2]), part: 1 },
  { noun: 'VFD', erpNoun: 'DRIVE,AC VARIABLE FREQUENCY', specs: [r => `${r.pick([0.75, 1.5, 2.2, 5.5, 7.5, 11, 22, 37])} kW`, () => '400V 3 phase', () => 'with keypad'], units: ['Nos', 'EA', 'SET'], qty: r => r.pick([1, 1, 2, 3]), part: 0.9 },
  { noun: 'IGBT module', erpNoun: 'IGBT MODULE', specs: [r => `${r.pick([50, 75, 100, 150, 300])}A ${r.pick([600, 1200, 1700])}V`], units: ['EA', 'Nos', 'PCS'], qty: few, part: 1 },
  { noun: 'Capacitor', erpNoun: 'CAPACITOR,ELECTROLYTIC', specs: [r => `${r.pick([47, 100, 220, 470, 1000])}UF`, r => `${r.pick([50, 63, 400, 450])} V`], units: ['EA', 'PCS', 'Nos'], qty: many, part: 0.2 },
  { noun: 'Opto coupler', erpNoun: 'OPTOCOUPLER', specs: [() => 'SMD', r => `${r.pick([4, 6, 8])} pin`], units: ['EA', 'PCS'], qty: many, part: 0.7 },
  { noun: 'Solenoid valve', erpNoun: 'VALVE,SOLENOID', specs: [r => `${r.pick(['1/4', '1/2', '3/4', '1'])} inch`, r => r.pick(['24VDC', '220VAC']), r => r.pick(['brass', 'SS316', '2/2 way NC'])], units: ['Nos', 'EA', 'PCS'], qty: few, part: 0.5 },
  { noun: 'Ball valve', erpNoun: 'VALVE,BALL', specs: [r => `${r.pick(['1/2', '1', '2', '3'])} inch`, r => r.pick(['SS316', 'brass', 'CS']), r => r.pick(['flanged', 'threaded', 'PN16'])], units: ['Nos', 'EA', 'PCS'], qty: few, part: 0.2 },
  { noun: 'Butterfly valve', erpNoun: 'VALVE,BUTTERFLY', specs: [r => `DN${r.pick([50, 80, 100, 150, 200])}`, () => 'wafer type', r => r.pick(['with gear', 'lever operated'])], units: ['Nos', 'EA', 'SET'], qty: few, part: 0.2 },
  { noun: 'Pneumatic cylinder', erpNoun: 'CYLINDER,PNEUMATIC', specs: [r => `bore ${r.pick([32, 40, 50, 63, 80])}mm`, r => `stroke ${r.pick([50, 100, 150, 200])}mm`], units: ['Nos', 'EA', 'PCS'], qty: few, part: 0.8 },
  { noun: 'Flow meter electromagnetic', erpNoun: 'FLOWMETER,ELECTROMAGNETIC', specs: [r => `DN${r.pick([15, 25, 50, 80, 100])}`, () => '4-20mA', () => 'PN16'], units: ['Nos', 'SET', 'EA'], qty: r => r.pick([1, 1, 2]), part: 0.7 },
  { noun: 'Level switch', erpNoun: 'SWITCH,LEVEL', specs: [r => r.pick(['float type', 'vibrating fork', 'rotary paddle']), r => r.pick(['SS316', '24VDC', '220VAC'])], units: ['Nos', 'EA', 'PCS'], qty: few, part: 0.5 },
  { noun: 'Limit switch', erpNoun: 'SWITCH,LIMIT', specs: [r => r.pick(['roller lever', 'plunger type', 'rod lever']), () => '1NO+1NC'], units: ['Nos', 'PCS', 'EA'], qty: few, part: 0.6 },
  { noun: 'Power supply', erpNoun: 'POWER SUPPLY', specs: [r => `24VDC ${r.pick([2.5, 5, 10, 20])}A`, () => 'DIN rail'], units: ['Nos', 'EA', 'PCS'], qty: few, part: 0.8 },
  { noun: 'Encoder', erpNoun: 'ENCODER,INCREMENTAL', specs: [r => `${r.pick([360, 600, 1024, 2048])} PPR`, r => `shaft ${r.pick([6, 8, 10])}mm`], units: ['Nos', 'EA', 'PCS'], qty: few, part: 0.9 },
  { noun: 'Bearing', erpNoun: 'BEARING,BALL', specs: [r => `${r.pick(['6205', '6206', '6305', '6308', '22216'])} ${r.pick(['2RS', 'ZZ', 'C3'])}`], units: ['Nos', 'PCS', 'EA', 'PAIR'], qty: few, part: 0 },
  { noun: 'Cable', erpNoun: 'CABLE,CONTROL', specs: [r => `${r.pick([2, 3, 4, 7, 12])} core ${r.pick([0.75, 1.5, 2.5])} mm2`, r => r.pick(['shielded', 'armoured', 'PVC'])], units: ['MTR', 'Mtr', 'M', 'ROLL', 'Meters'], qty: length, part: 0 },
  { noun: 'Cable gland', erpNoun: 'GLAND,CABLE', specs: [r => r.pick(['PG9', 'PG13.5', 'PG16', 'M20', 'M25']), r => r.pick(['brass', 'nylon'])], units: ['Nos', 'PCS', 'BOX', 'EA'], qty: many, part: 0 },
  { noun: 'Silicone sealant', erpNoun: 'SEALANT,SILICONE', specs: [r => `${r.pick([280, 300])} ml`, () => 'high temp'], units: ['PCS', 'BOX', 'Nos'], qty: many, part: 0 },
  { noun: 'Insulation tape', erpNoun: 'TAPE,INSULATION', specs: [r => r.pick(['PVC', 'self amalgamating']), r => r.pick(['black', '19mm'])], units: ['ROLL', 'Rolls', 'PCS'], qty: many, part: 0 },
  { noun: 'Thermal paste', erpNoun: 'COMPOUND,HEAT SINK', specs: [() => 'silicone based'], units: ['KG', 'Kg', 'PCS'], qty: weight, part: 0 },
  { noun: 'Gasket set', erpNoun: 'GASKET SET', specs: [r => `for pump ${r.pick(['50-200', '65-160', '80-250'])}`], units: ['SET', 'Sets', 'LOT'], qty: few, part: 0 },
  { noun: 'Carbon brush', erpNoun: 'BRUSH,CARBON', specs: [r => `${r.pick([10, 12.5, 16])}x${r.pick([20, 25, 32])}x${r.pick([32, 40])}mm`], units: ['PAIR', 'Nos', 'PCS', 'SET'], qty: few, part: 0.3 },
  { noun: 'Fuse', erpNoun: 'FUSE', specs: [r => r.pick(['glass 5x20', 'ceramic 6x32', 'NH00']), r => `${r.pick([1, 2, 4, 10, 63, 100])}A`], units: ['EA', 'PCS', 'BOX', 'Nos'], qty: many, part: 0.2 },
  { noun: 'Push button', erpNoun: 'PUSH BUTTON', specs: [r => r.pick(['green', 'red', 'mushroom red']), r => r.pick(['22mm', '1NO', '1NC'])], units: ['Nos', 'PCS', 'EA'], qty: many, part: 0.5 },
  { noun: 'Panel meter', erpNoun: 'METER,PANEL DIGITAL', specs: [r => r.pick(['voltmeter', 'ammeter', 'multifunction']), r => `${r.pick([72, 96])}x${r.pick([72, 96])}`], units: ['Nos', 'EA', 'PCS'], qty: few, part: 0.6 },
  { noun: 'Lubricating grease', erpNoun: 'GREASE,LUBRICATING', specs: [r => r.pick(['EP2', 'lithium complex', 'high temperature'])], units: ['KG', 'Kg', 'KGS'], qty: weight, part: 0 },
  { noun: 'Timing belt', erpNoun: 'BELT,TIMING', specs: [r => `${r.pick(['HTD', 'T10', 'XL'])} ${r.int(200, 1600)}`, r => `${r.pick([10, 15, 20, 25])}mm wide`], units: ['Nos', 'PCS', 'EA'], qty: few, part: 0.2 },
]

export function part(r: Rng): Part {
  const f = r.pick(FAMILIES)
  const specs = f.specs.filter(() => r.chance(0.8)).map(s => s(r))
  if (specs.length === 0) specs.push((f.specs[0] as (r: Rng) => string)(r))
  const hasPart = r.chance(f.part)
  const pn = hasPart ? partNumber(r) : null
  const brand = hasPart || r.chance(0.3) ? r.pick(BRAND) : null
  const plainBits = [f.noun, ...specs]
  let plain = r.chance(0.5) ? `${f.noun} ${specs.join(', ')}` : plainBits.join(' ')
  if (brand && r.chance(0.6)) plain = `${brand} ${plain}`
  if (pn) plain = r.chance(0.5) ? `${plain} ${pn}` : `${plain}, Model ${pn}`
  const caps = [f.noun.toUpperCase(), ...specs.map(s => s.toUpperCase()), ...(pn ? [pn] : []), ...(brand && r.chance(0.4) ? [brand.toUpperCase()] : [])].join(' ')
  const erp = `${f.erpNoun};${specs.map(s => s.toUpperCase().replace(/\s+/g, '')).join(',')}${pn ? ` ${r.pick(['P/N', 'MODEL', 'PN:'])} ${pn}` : ''}`
  return { plain, caps, erp, part: pn, brand, units: f.units, qty: f.qty }
}

/** n parts with no two sharing a description (the scorer pairs items by description). */
export function parts(r: Rng, n: number): Part[] {
  const out: Part[] = []
  const seen = new Set<string>()
  let guard = 0
  while (out.length < n && guard++ < n * 20) {
    const p = part(r)
    const key = p.plain.toLowerCase().split(/[^a-z]+/).slice(0, 3).join(' ')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

// ------------------------------------------------------------------------------------------------ dates

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const ord = (d: number) => `${d}${d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'}`
const p2 = (n: number) => String(n).padStart(2, '0')

export interface DateParts {
  iso: string
  y: number
  m: number
  d: number
}

/** A date `days` after 2026-10-20 (the corpus's "today"). */
export function dateAfter(days: number): DateParts {
  const t = new Date(Date.UTC(2026, 9, 20) + days * 86_400_000)
  const y = t.getUTCFullYear()
  const m = t.getUTCMonth() + 1
  const d = t.getUTCDate()
  return { iso: `${y}-${p2(m)}-${p2(d)}`, y, m, d }
}

/** The date written as a Pakistani office would write it (never ambiguous: day first, or with a month name). */
export function writeDate(r: Rng, x: DateParts, style?: number): string {
  const s = style ?? r.int(0, 8)
  switch (s) {
    case 0:
      return `${p2(x.d)}/${p2(x.m)}/${x.y}`
    case 1:
      return `${p2(x.d)}.${p2(x.m)}.${x.y}`
    case 2:
      return `${p2(x.d)}-${MON[x.m - 1]}-${x.y}`
    case 3:
      return `${x.d} ${MONTH[x.m - 1]} ${x.y}`
    case 4:
      return `${ord(x.d)} ${MONTH[x.m - 1]} ${x.y}`
    case 5:
      return `${MONTH[x.m - 1]} ${x.d}, ${x.y}`
    case 6:
      return `${p2(x.d)}-${(MON[x.m - 1] as string).toUpperCase()}-${String(x.y).slice(2)}`
    case 7:
      return x.iso
    default:
      return `${p2(x.d)}-${p2(x.m)}-${x.y}`
  }
}

export const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export function weekday(x: DateParts): string {
  return WEEKDAY[new Date(Date.UTC(x.y, x.m - 1, x.d)).getUTCDay()] as string
}
export function monthName(m: number): string {
  return MONTH[m - 1] as string
}
