import { toPaisa, type Amount } from '@/lib/money'

/*
 * Quotation arithmetic (R19). Exact integers, never floating point, and the same rounding the database applies in
 * quotation_set_totals (0022), so the dialog, the PDF and the stored totals always agree:
 *   line net = round(qty x unit price, 2)           (half away from zero, to the paisa)
 *   line GST = round(line net x rate / 100, 0)      (half away from zero, to WHOLE rupees, per line)
 *   a line at 0 % is GST-exempt: its GST is 0 and it adds nothing to the GST total.
 * Totals are sums of the rounded lines, never a rate applied to a sum.
 */

/** Integer division rounding half away from zero. */
function divRound(n: bigint, d: bigint): bigint {
  const neg = n < 0n !== d < 0n
  const an = n < 0n ? -n : n
  const ad = d < 0n ? -d : d
  const q = (an * 2n + ad) / (ad * 2n)
  return neg ? -q : q
}

/** A decimal as an integer scaled by 10^decimals (the digits beyond are rounded half away from zero). */
function scaled(value: Amount, decimals: number): bigint {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Not a decimal amount: "${value}"`)
  // toFixed switches to exponent notation from 1e21 (HW-2: a 22-digit price crashed the dialog). Numbers that large are whole.
  const text = typeof value === 'number' ? (Math.abs(value) >= 1e21 ? BigInt(value).toString() : value.toFixed(decimals + 2)) : value.trim()
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text)
  if (!m) throw new Error(`Not a decimal amount: "${text}"`)
  const [, sign, whole, frac = ''] = m
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals)
  let n = BigInt(whole + padded)
  if (frac.length > decimals && frac.charCodeAt(decimals) >= 53) n += 1n
  return sign === '-' ? -n : n
}

/** round(qty x unit price, 2), in paisa. Quantity has up to 3 decimals (numeric(12,3)). */
export function lineNetPaisa(qty: Amount, unitPrice: Amount): bigint {
  return divRound(scaled(qty, 3) * toPaisa(unitPrice), 1000n)
}

/** round(net x rate / 100, 0) rupees, returned in paisa (a multiple of 100). */
export function lineGstPaisa(netPaisa: bigint, ratePercent: Amount): bigint {
  const hundredths = scaled(ratePercent, 2)
  return divRound(netPaisa * hundredths, 1_000_000n) * 100n
}

export interface QuoteLineInput {
  qty: Amount
  unitPrice: Amount | null | undefined
  gstRate: Amount
}

export interface LineAmounts {
  /** false when there is no price yet: the line adds nothing. */
  priced: boolean
  net: bigint
  gst: bigint
  gross: bigint
}

export interface QuoteTotals {
  lines: LineAmounts[]
  net: bigint
  gst: bigint
  gross: bigint
  /** Net per GST rate (percent as written, e.g. "18"), for the "GST at 18%" rows. Exempt lines are under "0". */
  netByRate: Map<string, bigint>
  gstByRate: Map<string, bigint>
  pricedLines: number
}

const rateKey = (r: Amount): string => {
  const n = Number(r)
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(2)))
}

export function computeTotals(lines: readonly QuoteLineInput[]): QuoteTotals {
  const out: LineAmounts[] = []
  const netByRate = new Map<string, bigint>()
  const gstByRate = new Map<string, bigint>()
  let net = 0n
  let gst = 0n
  let priced = 0
  for (const l of lines) {
    if (l.unitPrice === null || l.unitPrice === undefined || l.unitPrice === '') {
      out.push({ priced: false, net: 0n, gst: 0n, gross: 0n })
      continue
    }
    const n = lineNetPaisa(l.qty, l.unitPrice)
    const g = lineGstPaisa(n, l.gstRate)
    out.push({ priced: true, net: n, gst: g, gross: n + g })
    const k = rateKey(l.gstRate)
    netByRate.set(k, (netByRate.get(k) ?? 0n) + n)
    gstByRate.set(k, (gstByRate.get(k) ?? 0n) + g)
    net += n
    gst += g
    priced++
  }
  return { lines: out, net, gst, gross: net + gst, netByRate, gstByRate, pricedLines: priced }
}

// ---------------------------------------------------------------- amount in words

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function below1000(n: number): string {
  const parts: string[] = []
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`)
    n %= 100
  }
  if (n >= 20) parts.push(n % 10 ? `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}` : TENS[Math.floor(n / 10)])
  else if (n > 0) parts.push(ONES[n])
  return parts.join(' ')
}

export function wholeInWords(n: number): string {
  if (n === 0) return 'zero'
  const groups: [number, string][] = [
    [1_000_000_000, 'billion'],
    [1_000_000, 'million'],
    [1_000, 'thousand'],
    [1, ''],
  ]
  const parts: string[] = []
  for (const [size, name] of groups) {
    const chunk = Math.floor(n / size)
    n %= size
    if (chunk > 0) parts.push(name ? `${below1000(chunk)} ${name}` : below1000(chunk))
  }
  return parts.join(' ')
}

/** "One million six hundred thirty-one thousand nine hundred forty rupees only." (the paise, when present, in figures-in-words too). */
export function amountInWords(paisa: bigint): string {
  const rupees = Number(paisa / 100n)
  const paise = Number(paisa % 100n)
  let s = `${wholeInWords(rupees)} ${rupees === 1 ? 'rupee' : 'rupees'}`
  if (paise > 0) s += ` and ${wholeInWords(paise)} ${paise === 1 ? 'paisa' : 'paise'}`
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} only.`
}
