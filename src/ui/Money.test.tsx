import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Margin, Money, MoneyFx, NetGstGross } from '@/ui/Money'
import { AfterDrawings, ExactEquation, SumBar } from '@/ui/SumBar'
import { StatusBadge } from '@/ui/StatusBadge'
import { StatusTrack } from '@/ui/StatusTrack'
import type { MarginState } from '@/lib/money'

const html = (node: React.ReactElement) => renderToStaticMarkup(node)
/** The visible text of a render, tags stripped. */
const text = (node: React.ReactElement) => html(node).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

describe('Money snapshots (D08 section 03)', () => {
  it('PKR figure, with and without the prefix', () => {
    expect(html(<Money value="1250000" />)).toMatchSnapshot()
    expect(html(<Money value="2280635.6" prefix={false} />)).toMatchSnapshot()
  })

  it('net, GST, gross', () => {
    expect(html(<NetGstGross net="1250000" gst="225000" gstRate={18} />)).toMatchSnapshot()
  })

  it('provisional and basis unknown', () => {
    expect(html(<Money value="412300" size="lg" provisional />)).toMatchSnapshot()
    expect(html(<Money value="3640000" size="lg" basisUnknown />)).toMatchSnapshot()
  })

  it('below cost, and not set', () => {
    expect(html(<Margin value="-84500" state="final" size="lg" />)).toMatchSnapshot()
    expect(html(<Money value={null} />)).toMatchSnapshot()
  })

  it('foreign: fresh, stale, unusable, none, captured', () => {
    expect(html(<MoneyFx amount="4820" currency="USD" rate="278.40" rateOn="2026-11-26" ageDays={1} />)).toMatchSnapshot()
    expect(html(<MoneyFx amount="18600" currency="CNY" rate="38.42" ageDays={14} />)).toMatchSnapshot()
    expect(html(<MoneyFx amount="12400" currency="AED" rate="75.8" ageDays={52} />)).toMatchSnapshot()
    expect(html(<MoneyFx amount="2200" currency="GBP" />)).toMatchSnapshot()
    expect(
      html(<MoneyFx amount="17900" currency="CNY" rate="38.42" ageDays={2} captured={{ rate: '39.10', on: '2026-10-03' }} />),
    ).toMatchSnapshot()
  })

  it('SumBar and the A6 after-drawings line', () => {
    expect(
      html(
        <SumBar
          label="November cash summary"
          items={[
            { label: 'Gross in', amount: '2841150', sub: '6 payments received' },
            { label: 'Net in', amount: '2280635.60' },
            { label: 'Payments', count: 6 },
          ]}
        />,
      ),
    ).toMatchSnapshot()
    expect(html(<AfterDrawings result="2280635.60" notInPnl="300000" />)).toMatchSnapshot()
  })

  it('status chip and track', () => {
    expect(html(<StatusBadge dimension="goods" value="late" />)).toMatchSnapshot()
    expect(html(<StatusBadge dimension="trust" value="basis_unknown" />)).toMatchSnapshot()
    expect(html(<StatusTrack dimension="fbr" value="receipt_received" />)).toMatchSnapshot()
  })
})

describe('exact figures', () => {
  it('keeps the paisa', () => {
    expect(text(<Money value="410514.4" />)).toBe('PKR 410,514.40')
  })

  it('net, GST and gross: gross is always net plus GST', () => {
    const t = text(<NetGstGross net="612000.10" gst="110160.02" />)
    expect(t).toContain('722,160.12')
  })

  it('shows the stored gross with a flag when it does not equal net + GST', () => {
    const t = text(<NetGstGross net="100" gst="18" gross="119" />)
    expect(t).toContain('119')
    expect(t).toContain('Does not equal net + GST')
  })

  it('after drawings is result minus not-in-P&L, to the paisa', () => {
    expect(text(<AfterDrawings result="2280635.60" notInPnl="300000.05" />)).toContain('1,980,635.55')
  })

  it('flags an after-drawings figure that disagrees with its parts', () => {
    expect(text(<AfterDrawings result="1000" notInPnl="100" afterDrawings="950" />)).toContain('Result less drawings is PKR 900')
  })

  it('uses the text PKR, never the rupee sign', () => {
    expect(html(<Money value="5" />)).not.toContain('₨')
  })

  it('stale and unusable foreign rates say so in words', () => {
    expect(text(<MoneyFx amount="18600" currency="CNY" rate="38.42" ageDays={14} />)).toContain('rate 14 days old')
    const unusable = text(<MoneyFx amount="12400" currency="AED" rate="75.8" ageDays={52} />)
    expect(unusable).toContain('not compared')
    expect(unusable).not.toContain('PKR') // no converted figure at all
  })
})

describe('a margin is never shown without the provisional mark when costs are incomplete (U06)', () => {
  const values = ['553600', '0', '-84500', '0.01', '1250000.99']
  const states: Array<MarginState | null | undefined> = ['provisional', null, undefined, 'bogus' as MarginState]

  it('every value in every non-final state carries the dashed underline and the Provisional chip', () => {
    for (const value of values) {
      for (const state of states) {
        const out = html(<Margin value={value} state={state} />)
        expect(out, `${value} / ${String(state)}`).toContain('data-provisional')
        expect(out, `${value} / ${String(state)}`).toContain('decoration-dashed')
        expect(out, `${value} / ${String(state)}`).toContain('Provisional')
      }
    }
  })

  it('the underline-only mark still carries the dashed underline and the screen-reader word', () => {
    const out = html(<Margin value="100" state="provisional" mark="underline" />)
    expect(out).toContain('decoration-dashed')
    expect(out).toContain('sr-only')
    expect(out).toContain('Provisional')
  })

  it('only a final margin renders unmarked', () => {
    const out = html(<Margin value="553600" state="final" />)
    expect(out).not.toContain('data-provisional')
    expect(out).not.toContain('Provisional')
  })

  it('basis unknown shows no number, only the dashed Basis unknown chip', () => {
    const out = html(<Margin value="553600" state="basis_unknown" />)
    expect(out).not.toContain('553,600')
    expect(out).toContain('Basis unknown')
  })

  it('a negative margin says "below cost" in words as well as colour', () => {
    expect(text(<Margin value="-84500" state="final" />)).toContain('below cost')
  })
})

describe('SumBar headline (approved mockup: whole rupees; exact paisa lives in the rows and the equation)', () => {
  const bar = <SumBar label="x" items={[{ label: 'Net in', amount: '2280635.60' }, { label: 'GST', amount: '410514.40', paisa: 'always' }]} />
  it('rounds to whole rupees by default and can be told otherwise', () => {
    const t = text(bar)
    expect(t).toContain('2,280,636')
    expect(t).not.toContain('2,280,635.60')
    expect(t).toContain('410,514.40')
  })

  it('the exact equation adds up to the paisa, or says it does not', () => {
    const parts = [{ amount: '2280635.60', label: 'net' }, { amount: '410514.40', label: 'GST' }, { amount: '150000', label: 'not yet split' }]
    expect(text(<ExactEquation total="2841150" parts={parts} />)).toBe('2,841,150 = 2,280,635.60 net + 410,514.40 GST + 150,000 not yet split')
    expect(text(<ExactEquation total="2841151" parts={parts} />)).toContain('parts add to 2,841,150')
  })
})
