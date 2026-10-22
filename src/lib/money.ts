/*
 * Exact money arithmetic (U06). Every amount is held as an integer number of paisa
 * (bigint), so a total is always the exact sum of its rows and nothing is rounded
 * by floating point. Inputs are what PostgREST returns for numeric(14,2): a JSON
 * number or a decimal string.
 */
export type Amount = number | string

const PAISA = 100n
const RATE_SCALE = 1_000_000n // exchange rates are carried to 6 decimals

/** Decimal text to a scaled bigint, rounding half away from zero beyond `decimals`. */
function scaled(text: string, decimals: number): bigint {
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text.trim())
  if (!m) throw new Error(`Not a decimal amount: "${text}"`)
  const [, sign, whole, frac = ''] = m
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals)
  let n = BigInt(whole + padded)
  if (frac.length > decimals && frac.charCodeAt(decimals) >= 53 /* '5' */) n += 1n
  return sign === '-' ? -n : n
}

/** An amount in rupees (number or decimal string) as paisa. Throws on anything that is not a finite decimal. */
export function toPaisa(value: Amount): bigint {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Not a finite amount: ${value}`)
    // JSON numbers from numeric(14,2) have at most 2 decimals; toFixed(2) gives the same digits without float drift.
    // From 1e21 toFixed writes an exponent ("1e+22", HW-2); numbers that large are whole, so BigInt reads them exactly.
    if (Math.abs(value) >= 1e21) return BigInt(value) * PAISA
    return scaled(value.toFixed(2), 2)
  }
  return scaled(value, 2)
}

export function sumPaisa(values: Iterable<Amount | bigint>): bigint {
  let total = 0n
  for (const v of values) total += typeof v === 'bigint' ? v : toPaisa(v)
  return total
}

/** Rupees as a fixed two-decimal string with no grouping ("-84500.00"); for CSV and inputs. */
export function paisaToFixed(p: bigint): string {
  const neg = p < 0n
  const abs = neg ? -p : p
  const s = `${abs / PAISA}.${String(abs % PAISA).padStart(2, '0')}`
  return neg ? `-${s}` : s
}

export type PaisaMode = 'auto' | 'always' | 'never'

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/**
 * "1,234,567" or "1,234,567.50". Western thousands grouping (the mockups), a true
 * minus sign (U+2212), and the paisa kept: 'auto' shows them only when non-zero,
 * 'always' shows two decimals, 'never' rounds half away from zero (headline tiles only).
 */
export function formatPaisa(p: bigint, mode: PaisaMode = 'auto'): string {
  let v = p
  if (mode === 'never') v = p < 0n ? -((-p + 50n) / PAISA) * PAISA : ((p + 50n) / PAISA) * PAISA
  const neg = v < 0n
  const abs = neg ? -v : v
  const whole = group(String(abs / PAISA))
  const cents = abs % PAISA
  const frac = mode === 'always' || (mode === 'auto' && cents !== 0n) ? `.${String(cents).padStart(2, '0')}` : ''
  return `${neg ? '−' : ''}${whole}${frac}`
}

export function formatAmount(value: Amount, mode: PaisaMode = 'auto'): string {
  return formatPaisa(toPaisa(value), mode)
}

/** True when any paisa is non-zero: a column then shows two decimals on every row so digits stay aligned. */
export function hasPaisa(values: Iterable<Amount | null | undefined>): boolean {
  for (const v of values) if (v !== null && v !== undefined && toPaisa(v) % PAISA !== 0n) return true
  return false
}

/** Foreign amount x rate (PKR per unit, up to 6 decimals), rounded once to the paisa. */
export function convertToPaisa(foreign: Amount, rate: Amount): bigint {
  const f = toPaisa(foreign) // paisa-scaled
  const r = scaled(typeof rate === 'number' ? String(rate) : rate, 6)
  const prod = f * r // scale 100 * 1e6
  const half = RATE_SCALE / 2n
  return prod >= 0n ? (prod + half) / RATE_SCALE : -((-prod + half) / RATE_SCALE)
}

/** A number or decimal text as an integer scaled by 10^decimals (beyond that, half away from zero). */
function scaledAmount(value: Amount, decimals: number): bigint {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Not a finite amount: ${value}`)
    // two spare digits: 1.005 (binary 1.00499999...) reads as "1.005000", the decimal it was typed as
    return scaled(value.toFixed(decimals + 2), decimals)
  }
  return scaled(value, decimals)
}

/** n / d rounded half away from zero (d > 0). */
function divRound(n: bigint, d: bigint): bigint {
  return n >= 0n ? (n * 2n + d) / (d * 2n) : -((-n * 2n + d) / (d * 2n))
}

/**
 * round(qty x price, 2) in paisa, exactly as Postgres numeric does it (half away from zero). Quantity up to 3 decimals
 * (numeric(12,3)), price up to 6 (supplier prices are numeric(14,4); a typed PO price may carry more). A float product
 * cannot be used: 1 x 1.005 x 100 is 100.49999999999999 in floating point and would round to 1.00 where the database
 * stores 1.01.
 */
export function productPaisa(qty: Amount, price: Amount): bigint {
  return divRound(scaledAmount(qty, 3) * scaledAmount(price, 6), 10_000_000n)
}

/** round(Σ qty x price, 2) in paisa: the products are summed exactly and rounded once (half away from zero). */
export function sumProductsPaisa(pairs: Iterable<readonly [Amount, Amount]>): bigint {
  let s = 0n
  for (const [q, p] of pairs) s += scaledAmount(q, 3) * scaledAmount(p, 6)
  return divRound(s, 10_000_000n)
}

/** n / d rounded half away from zero, exact integers (d > 0). For shares such as the GST of part of an invoice. */
export const divRoundHalfUp = (n: bigint, d: bigint): bigint => divRound(n, d)

/** GST on a line net, rounded to whole rupees (DATA_MODEL 2.13), in paisa: round(net x rate / 100, 0) x 100. */
export function gstWholeRupeesPaisa(netPaisa: bigint, ratePercent: Amount): bigint {
  return divRound(netPaisa * scaledAmount(ratePercent, 2), 1_000_000n) * 100n
}

/** Rate text for display: trailing zeros kept to two decimals ("278.40"), more only if present ("0.0034"). */
export function formatRate(rate: Amount): string {
  const s = typeof rate === 'number' ? String(rate) : rate.trim()
  const [w, f = ''] = s.split('.')
  const trimmed = f.replace(/0+$/, '')
  return `${group(w)}.${trimmed.padEnd(2, '0')}`
}

/** Margin guard (U06): a margin is final only when costs are complete. Anything else must carry the mark. */
export type MarginState = 'final' | 'provisional' | 'basis_unknown'
export function isFinalMargin(state: MarginState | null | undefined): boolean {
  return state === 'final'
}

export type FxStaleness = 'fresh' | 'stale' | 'unusable'
/** Rate age bands (DATA_MODEL section 5, v_fx_latest): up to 7 days fresh, 8 to 30 stale, over 30 unusable. */
export function fxStaleness(ageDays: number): FxStaleness {
  return ageDays <= 7 ? 'fresh' : ageDays <= 30 ? 'stale' : 'unusable'
}
