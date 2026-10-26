/**
 * Infers a product category from an item description, in the app, with no AI service. The categories are the canonical
 * names of the "family" rows in `brands` (0006_companies.sql), so a result can be looked up against the families on file.
 *
 * Rules: the longest, most specific match wins ("mccb" beats "mcb", "overload relay" beats "relay"); two categories tied
 * on length, or two that are known to be easy to confuse (a level switch and a radar level transmitter), come back as
 * `unsure` with both candidates, never as a guess.
 */

export interface CategoryInference {
  name: string | null
  confidence: 'sure' | 'unsure' | 'none'
  candidates: string[]
  matched: string
}

interface Entry {
  name: string
  /** Strings are matched on whole words in normalised text (spaces stand for any separator; a trailing s/es is allowed). Regexes are used as written. */
  keywords: (string | RegExp)[]
  /** If this is present the entry does not apply at all. */
  exclude?: RegExp
  /** Categories that, when they also match, make the answer unsure rather than a win. */
  confusedWith?: string[]
}

// ------------------------------------------------------------------------------------------------ normaliser

/**
 * TypeScript port of the database's item_text_norm() (0023_issue_rpcs.sql): lower case, standalone quantities and units
 * dropped (so model codes like FX2N survive), punctuation removed, spaces collapsed. "PT 100" is joined first so the
 * quantity rule does not eat the 100.
 */
export function normaliseItemText(t: string): string {
  return (t ?? '')
    .toLowerCase()
    .replace(/\bpt\s*(100|1000)\b/g, 'pt$1')
    .replace(/(?<![a-z0-9])[0-9]+([.,][0-9]+)?\s*(mm|cm|m|kv|v|ma|a|kw|w|hz|bar|psi|pcs|nos|no|x)?(?![a-z0-9])/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const PROTECTION_WORDS = /\b(overload|o load|thermal|protection|safety|monitoring|phase|under|over|earth fault|voltage|sequence)\b/

const ENTRIES: Entry[] = [
  // ---- breakers and switchgear
  { name: 'MCB', keywords: ['mcb', 'miniature circuit breaker', 'mini circuit breaker'] },
  { name: 'MCCB', keywords: ['mccb', 'mpcb', 'moulded case circuit breaker', 'molded case circuit breaker', 'moulded case', 'motor protection circuit breaker'] },
  { name: 'ACB', keywords: ['acb', 'air circuit breaker'] },
  { name: 'RCCB/ELCB', keywords: ['rccb', 'elcb', 'rcbo', 'rcd', 'residual current', 'earth leakage'] },
  { name: 'Contactors', keywords: ['contactor', 'motor starter', 'dol starter', 'star delta starter'] },
  { name: 'Isolators', keywords: ['isolator', 'switch disconnector', 'disconnector', 'load break switch', 'lbs'] },
  { name: 'Fuses', keywords: ['fuse', 'fuse holder', 'fuse base', 'fuse link', 'hrc'] },

  // ---- relays and timers
  { name: 'Overload relays', keywords: ['overload relay', 'overload', 'thermal relay', 'thermal overload', /\bthermal o ?load\b/, /\bo ?load relay\b/, 'olr'] },
  { name: 'Control relays', keywords: ['relay', 'relay base', 'relay socket', 'control relay'], exclude: PROTECTION_WORDS },
  {
    name: 'Protection/monitoring relays',
    keywords: [
      'monitoring relay',
      'protection relay',
      'safety relay',
      'phase failure',
      'phase sequence',
      'phase loss',
      'under voltage',
      'over voltage',
      'under over',
      'earth fault relay',
      'rms monitoring',
    ],
  },
  { name: 'Timers', keywords: ['timer', 'time delay relay', 'on delay', 'off delay', 'star delta timer'] },

  // ---- automation and drives
  { name: 'PLC', keywords: ['plc', 'programmable logic controller', 's7', /\bfx[0-9][a-z0-9]*\b/, 'cpu'] },
  { name: 'HMI', keywords: ['hmi', 'human machine interface', 'touch screen', 'touchscreen', 'touch panel'] },
  { name: 'VFD/drives', keywords: ['vfd', 'vsd', 'inverter', 'ac drive', 'variable frequency', 'variable speed drive', 'frequency converter', 'servo drive'] },
  { name: 'Soft starters', keywords: ['soft starter', 'softstarter'] },
  { name: 'Power supplies', keywords: ['smps', 'power supply', 'power supplies', 'dc power supply'] },

  // ---- pressure
  { name: 'Pressure transmitters', keywords: ['pressure transmitter', 'pressure transducer', 'pressure sensor', 'dp transmitter'] },
  { name: 'Pressure gauges', keywords: ['pressure gauge', 'pressure gage', 'manometer', 'bourdon'] },
  { name: 'Pressure switches', keywords: ['pressure switch', 'pressostat'] },
  // "PT" alone: a pressure transmitter or a potential transformer. A context word excludes the other reading; with none, both tie and the answer is unsure.
  { name: 'Pressure transmitters', keywords: [/\bpt\b/], exclude: /\b(potential|voltage|transformer|metering|ct|busbar)\b/ },
  { name: 'CT/PT', keywords: [/\bpt\b/], exclude: /\b(pressure|transmitter|transducer|gauge|psi|bar|loop)\b/ },

  // ---- temperature
  { name: 'Temperature transmitters', keywords: ['temperature transmitter', 'temp transmitter'] },
  { name: 'Temperature controllers', keywords: ['temperature controller', 'temp controller', 'pid controller', /\btcn[0-9][a-z0-9]*\b/] },
  { name: 'RTD/thermocouples', keywords: ['pt100', 'pt1000', 'rtd', 'thermocouple', 'thermowell', 'temperature sensor', 'temperature probe'] },

  // ---- level, flow, analysis
  {
    name: 'Level switches',
    keywords: ['level switch', 'float switch', 'rotary level', 'bin level', 'tuning fork', 'vibrating fork', 'paddle switch'],
    confusedWith: ['Level transmitters'],
  },
  {
    name: 'Level transmitters',
    keywords: ['radar level', 'ultrasonic level', 'level transmitter', 'level transducer', 'guided wave', 'hydrostatic level', 'radar'],
    confusedWith: ['Level switches'],
  },
  {
    name: 'Flow meters',
    keywords: ['flow meter', 'flowmeter', 'flow transmitter', 'flow sensor', 'electromagnetic flow', 'magnetic flow', 'mag flow', 'vortex', 'coriolis', 'rotameter'],
  },
  {
    name: 'Analysers',
    keywords: [
      'analyser',
      'analyzer',
      'ph meter',
      'ph sensor',
      'ph electrode',
      'ph probe',
      'ph transmitter',
      'ph controller',
      'conductivity',
      'dissolved oxygen',
      'do sensor',
      'do meter',
      'turbidity',
      'orp',
      'chlorine',
    ],
  },

  // ---- valves
  { name: 'Solenoid valves', keywords: ['solenoid valve', 'solenoid coil', 'solenoid'] },
  {
    name: 'Control valves/actuators',
    keywords: ['control valve', 'actuator', 'valve positioner', 'positioner', 'modulating valve', 'motorised valve', 'motorized valve'],
  },

  // ---- operator and sensing devices
  { name: 'Push buttons', keywords: ['push button', 'pushbutton', 'push button station', 'emergency stop', 'e stop', 'mushroom head'] },
  { name: 'Pilot lamps', keywords: ['pilot lamp', 'pilot light', 'indicator lamp', 'indicating lamp', 'indicator light', 'signal lamp', 'signal light'] },
  { name: 'Selector switches', keywords: ['selector switch', 'selector', 'cam switch', 'changeover switch', 'change over switch', 'key switch'] },
  { name: 'Limit switches', keywords: ['limit switch', 'micro switch', 'microswitch'] },
  { name: 'Proximity sensors', keywords: ['proximity', 'prox sensor', 'inductive sensor', 'capacitive sensor'] },
  { name: 'Photoelectric sensors', keywords: ['photoelectric', 'photo electric', 'photo sensor', 'through beam', 'retro reflective', 'diffuse sensor'] },
  { name: 'Encoders', keywords: ['encoder', 'rotary encoder', 'pulse generator'] },

  // ---- wiring
  {
    name: 'Cables',
    keywords: ['cable', 'power cable', 'control cable', 'armoured cable', 'flexible cable', 'instrumentation cable'],
    exclude: /\b(tray|ladder|duct|trunking|tie|marker|gland|lug|thimble)\b/,
  },
  { name: 'Cable glands', keywords: ['cable gland', 'gland'] },
  { name: 'Cable lugs/thimbles', keywords: ['lug', 'thimble', 'cable lug', 'copper lug', 'ring lug', 'terminal lug', 'tubular lug', 'ferrule'] },
  { name: 'Terminal blocks', keywords: ['terminal block', 'terminal strip', 'din rail terminal', 'connector block'] },

  // ---- panels, metering, power quality, power
  {
    name: 'Enclosures/DBs',
    keywords: ['db', 'distribution board', 'enclosure', 'panel', 'plc panel', 'junction box', 'jb', 'control panel', 'mcc panel', 'marshalling'],
    exclude: /\bpanel (mount|mounted|meter)\b/,
  },
  {
    name: 'Energy meters',
    keywords: [
      'energy meter',
      'kwh meter',
      'power meter',
      'multifunction meter',
      'multi function meter',
      'digital meter',
      'ammeter',
      'ampere meter',
      'voltmeter',
      'volt meter',
      'frequency meter',
      'panel meter',
      'power analyser',
      'mfm',
    ],
  },
  { name: 'CT/PT', keywords: ['current transformer', 'potential transformer', 'voltage transformer', 'ct'] },
  { name: 'Capacitors', keywords: ['capacitor', 'apfc', 'pfi', 'power factor', 'pf correction'] },
  { name: 'Motors', keywords: ['motor', 'electric motor', 'induction motor', 'gear motor', 'geared motor', 'servo motor'] },
  { name: 'UPS/batteries', keywords: ['ups', 'battery', 'batteries', 'lead acid', 'ni cd'] },

  // ---- service
  { name: 'Commissioning service', keywords: ['commissioning', 'start up service', 'calibration service'] },
]

// ------------------------------------------------------------------------------------------------ compile

interface Compiled extends Omit<Entry, 'keywords'> {
  patterns: RegExp[]
}

const compile = (kw: string | RegExp): RegExp => {
  if (kw instanceof RegExp) return new RegExp(kw.source, 'g')
  const words = kw.split(' ').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`\\b${words.join('\\s+')}(?:s|es)?\\b`, 'g')
}

let compiled: Compiled[] | null = null
const entries = (): Compiled[] =>
  (compiled ??= ENTRIES.map(e => ({
    name: e.name,
    exclude: e.exclude,
    confusedWith: e.confusedWith,
    patterns: e.keywords.map(compile),
  })))

/** The canonical category names, each once. */
export const CATEGORY_NAMES: readonly string[] = [...new Set(ENTRIES.map(e => e.name))]

/** The longest hit one pattern makes in the text, or ''. */
function longestHit(re: RegExp, text: string): string {
  let best = ''
  for (const m of text.matchAll(re)) if (m[0].length > best.length) best = m[0]
  return best
}

export function inferCategory(description: string): CategoryInference {
  const text = normaliseItemText(description)
  const none: CategoryInference = { name: null, confidence: 'none', candidates: [], matched: '' }
  if (!text) return none

  // best match per category (one name may have several entries, e.g. "PT")
  const hits = new Map<string, { score: number; matched: string; confusedWith: string[] }>()
  for (const e of entries()) {
    if (e.exclude?.test(text)) continue
    for (const p of e.patterns) {
      const hit = longestHit(p, text)
      if (!hit) continue
      const prev = hits.get(e.name)
      if (!prev || hit.length > prev.score) hits.set(e.name, { score: hit.length, matched: hit, confusedWith: e.confusedWith ?? [] })
    }
  }
  if (hits.size === 0) return none

  const ranked = [...hits.entries()].sort((a, b) => b[1].score - a[1].score)
  const [topName, top] = ranked[0]
  const tied = ranked.filter(([, h]) => h.score === top.score).map(([n]) => n)
  if (tied.length > 1) return { name: null, confidence: 'unsure', candidates: tied, matched: top.matched }
  const confused = top.confusedWith.filter(n => hits.has(n))
  if (confused.length > 0) return { name: null, confidence: 'unsure', candidates: [topName, ...confused], matched: top.matched }
  return { name: topName, confidence: 'sure', candidates: [topName], matched: top.matched }
}
