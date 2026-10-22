import { describe, expect, it } from 'vitest'
import type { FxLatestRow } from '@/features/rfqs/api'
import { ageText, autoRunStamp, bandLabel, buildRateBar, buildRateRows, rateBarNote, manualRateProblem, rateCardLine, sourceText, unusableWarning } from './ratesModel'

const row = (currency: string, ratePkr: number, ageDays: number, source = 'auto'): FxLatestRow => ({
  currency,
  ratePkr,
  asOf: '2026-11-27',
  source,
  ageDays,
  staleness: ageDays <= 7 ? 'fresh' : ageDays <= 30 ? 'stale' : 'unusable',
})

describe('rates table', () => {
  const rows = buildRateRows([row('GBP', 372.4, 54), row('USD', 281.35, 0), row('CNY', 38.85, 8, 'manual')])
  it('orders fresh, stale, unusable, then currencies with no rate', () => {
    expect(rows.map(r => r.currency)).toEqual(['USD', 'CNY', 'GBP', 'AED', 'EUR', 'JPY', 'SAR'])
  })
  it('offers every currency of the app, with no rate, so Add rate is always there', () => {
    expect(rows.find(r => r.currency === 'EUR')).toMatchObject({ ratePkr: null, staleness: null, source: null })
    expect(rows.some(r => r.currency === 'PKR')).toBe(false)
  })
  it('words the age, the band and the source', () => {
    expect(ageText(0)).toBe('today')
    expect(ageText(1)).toBe('1 day')
    expect(ageText(8)).toBe('8 days')
    expect(bandLabel('fresh', 3)).toBe('3 days') // a fresh rate is its age, no chip
    expect(bandLabel('fresh', 0)).toBe('today')
    expect(bandLabel('stale', 8)).toBe('Old rate, 8 days old')
    expect(bandLabel('unusable', 54)).toBe('No rate, 54 days old')
    expect(sourceText('manual')).toBe('Entered by hand')
    expect(sourceText('auto')).toBe('Automatic')
  })
  it('warns only about an unusable rate, in the mockup words', () => {
    const w = unusableWarning(rows.find(r => r.currency === 'GBP')!)
    expect(w).toMatch(/^GBP has not been updated for 54 days\. A rate older than 30 days is not used/)
    expect(unusableWarning(rows.find(r => r.currency === 'CNY')!)).toBeNull()
  })
})

describe('rate bar', () => {
  const latest = [row('USD', 279.4, 0), row('CNY', 38.6, 3), row('EUR', 305.2, 12)]
  it('lists the currencies with a rate, then those on a price that have none, in the bar order', () => {
    const bar = buildRateBar(latest, ['USD', 'AED', 'PKR'])
    expect(bar.map(b => b.currency)).toEqual(['CNY', 'EUR', 'USD', 'AED'])
    expect(bar.find(b => b.currency === 'AED')?.ratePkr).toBeNull()
  })
  it('words each entry as in the mockup', () => {
    const bar = buildRateBar(latest, [])
    expect(rateBarNote(bar.find(b => b.currency === 'USD')!)).toBe('auto · today')
    expect(rateBarNote(bar.find(b => b.currency === 'CNY')!)).toBe('auto · 3 days ago')
    expect(rateBarNote(bar.find(b => b.currency === 'EUR')!)).toBe('auto · 12 days ago, stale')
  })
})

describe('autoRunStamp', () => {
  it('reads the nightly run in Karachi time, as the mockup does', () => {
    expect(autoRunStamp('2026-11-26T21:10:00Z')).toBe('Automatic update ran Fri 27 Nov, 02:10')
  })
})

describe('rateCardLine (phone cards)', () => {
  it('reads "USD 280.50 · 22 Oct · by hand", and says when there is no rate', () => {
    expect(rateCardLine({ currency: 'USD', ratePkr: 280.5, asOf: '2026-10-22', source: 'manual' })).toBe('USD 280.50 · 22 Oct · by hand')
    expect(rateCardLine({ currency: 'EUR', ratePkr: 301.15, asOf: '2026-10-21', source: 'auto' })).toBe('EUR 301.15 · 21 Oct · automatic')
    expect(rateCardLine({ currency: 'JPY', ratePkr: null, asOf: null, source: null })).toBe('JPY · no rate yet')
  })
})

describe('HW-46: a rate typed by hand', () => {
  const at = (text: string, rate: number | null, asOf = '2026-10-22', last: number | null = 74.9) =>
    manualRateProblem({ text, rate, asOf, today: '2026-10-22', last })
  it('refuses an absurd rate, a zero and a future date, each under its own field', () => {
    expect(at('1,000,000,000', 1e9)).toMatchObject({ field: 'rate', error: expect.stringMatching(/too large/) })
    expect(at('0', 0)).toMatchObject({ field: 'rate', error: expect.stringMatching(/above zero/) })
    expect(at('75', 75, '2026-11-21')).toMatchObject({ field: 'asOf', error: expect.stringMatching(/future/) })
  })
  it('asks for a second look, without blocking, when far from the latest rate', () => {
    expect(at('750', 750)).toMatchObject({ error: null, warning: expect.stringMatching(/far from the latest rate/) })
    expect(at('76.2', 76.2)).toEqual({ error: null, field: null, warning: null })
    expect(at('', null)).toEqual({ error: null, field: null, warning: null })
  })
})