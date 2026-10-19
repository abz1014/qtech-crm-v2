import type { ReactNode } from 'react'
import { CircleAlert, Clock, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import { StatusBadge } from '@/ui/StatusBadge'
import { Tooltip } from '@/ui/Tooltip'
import {
  convertToPaisa,
  formatAmount,
  formatPaisa,
  formatRate,
  fxStaleness,
  isFinalMargin,
  paisaToFixed,
  toPaisa,
  type Amount,
  type FxStaleness,
  type MarginState,
  type PaisaMode,
} from '@/lib/money'
import { formatDay } from '@/lib/formatDay'

/*
 * Money (D08 section 03). Rules, all from the design system:
 *  - Mono tabular figures, thousands separators, the paisa kept when it is not zero.
 *  - The prefix is the text "PKR" (Geist has no rupee glyph). Inside a column whose
 *    header says PKR, pass prefix={false}.
 *  - A missing value is an em dash in muted text, never 0.
 *  - Negative values use a true minus and danger colour; the word ("below cost")
 *    is added by <Margin>, so colour is never the only signal.
 *  - Provisional: dashed underline plus the warning chip. Basis unknown: shown as
 *    typed, with the dashed warning chip. Nothing here converts or hides either.
 */
type Size = 'sm' | 'base' | 'lg' | 'xl' | 'display'
const SIZE: Record<Size, string> = {
  sm: 'text-sm',
  base: 'text-base',
  lg: 'text-lg tracking-snug',
  xl: 'text-xl tracking-snug',
  display: 'text-display font-medium tracking-tight',
}
const CCY_SIZE: Record<Size, string> = { sm: 'text-xs', base: 'text-xs', lg: 'text-xs', xl: 'text-xs', display: 'text-base' }

export interface MoneyProps {
  value: Amount | null | undefined
  /** Show the "PKR" prefix. Default true. */
  prefix?: boolean
  paisa?: PaisaMode
  /** Omit to inherit the surrounding text size (table cells). */
  size?: Size
  /** Costs are estimates: dashed underline, plus the chip unless `mark="underline"`. */
  provisional?: boolean
  /** Legacy value whose net or gross was never recorded: shown as typed with the chip. */
  basisUnknown?: boolean
  /** Dense cells: keep the dashed underline and the screen-reader text, drop the chip. */
  mark?: 'chip' | 'underline'
  /** Medium weight for emphasised figures (totals, gross). */
  strong?: boolean
  /** A statement line that is negative by design (a cost under "money out"): the minus is kept, the danger colour is not. */
  plainNegative?: boolean
  className?: string
}

export function Money({
  value,
  prefix = true,
  paisa = 'auto',
  size,
  provisional,
  basisUnknown,
  mark = 'chip',
  strong,
  plainNegative,
  className,
}: MoneyProps) {
  const missing = value === null || value === undefined
  const p = missing ? null : toPaisa(value)
  const negative = p !== null && p < 0n
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-2', className)}>
      <span
        className={cn(
          'num whitespace-nowrap',
          size && SIZE[size],
          (strong || size === 'display') && 'font-medium',
          negative && !plainNegative && 'text-tone-danger-fg',
          (missing || (provisional && mark === 'underline')) && 'text-fg-muted',
        )}
      >
        {missing ? (
          <>
            <span aria-hidden="true">{'—'}</span>
            <span className="sr-only">Not set</span>
          </>
        ) : (
          <>
            {prefix ? <span className={cn('mr-1 font-sans font-regular text-fg-muted', size ? CCY_SIZE[size] : 'text-xs')}>PKR</span> : null}
            <span
              data-provisional={provisional ? '' : undefined}
              className={cn(
                provisional && 'underline decoration-dashed underline-offset-4',
                provisional && (mark === 'chip' ? 'decoration-tone-warning-fg' : 'decoration-fg-muted'),
              )}
            >
              {formatPaisa(p as bigint, paisa)}
            </span>
          </>
        )}
      </span>
      {provisional ? (
        mark === 'chip' ? (
          <Tooltip forDisabled content="Some costs are still estimates, so this figure can change.">
            <StatusBadge dimension="costs" value="provisional" />
          </Tooltip>
        ) : (
          <span className="sr-only">Provisional</span>
        )
      ) : null}
      {basisUnknown ? (
        mark === 'chip' ? (
          <Tooltip forDisabled content="The net or gross value was never recorded for this legacy order. Shown as typed.">
            <StatusBadge dimension="trust" value="basis-unknown" />
          </Tooltip>
        ) : (
          <span className="sr-only">Basis unknown</span>
        )
      ) : null}
    </span>
  )
}

/*
 * Margin: the only way to show a margin. It cannot be rendered without the
 * provisional mark unless the view says costs are complete (state 'final'); a
 * missing or unknown state is treated as provisional. A negative margin carries
 * the words "below cost" as well as the red.
 */
export interface MarginProps {
  value: Amount | null | undefined
  /** margin_state from v_order_money. */
  state: MarginState | null | undefined
  size?: Size
  prefix?: boolean
  mark?: 'chip' | 'underline'
  className?: string
}

export function Margin({ value, state, size, prefix, mark, className }: MarginProps) {
  const basisUnknown = state === 'basis_unknown'
  const provisional = !isFinalMargin(state) && !basisUnknown
  const below = value !== null && value !== undefined && toPaisa(value) < 0n
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-2', className)} data-margin-state={state ?? 'provisional'}>
      <Money
        value={basisUnknown ? null : value}
        size={size}
        prefix={prefix}
        provisional={provisional}
        basisUnknown={basisUnknown}
        mark={mark}
      />
      {below ? <span className="text-sm font-medium text-tone-danger-fg">below cost</span> : null}
    </span>
  )
}

/*
 * MoneyFx: a foreign amount, original first, then the PKR conversion at the rate
 * with its date. Fresh up to 7 days; stale 8 to 30 (still converted, amber, with
 * its age); unusable over 30 (no PKR figure, not compared); no rate yet (a quiet line and a
 * separate quiet chip "not compared, no rate").
 * "Captured" shows the rate recorded on the quote line ("at the time") beside
 * today's, clearly labelled.
 */
export interface MoneyFxProps {
  amount: Amount
  /** ISO code: USD, EUR, AED, CNY, GBP... */
  currency: string
  /** PKR per unit, from v_fx_latest. Null when there is no rate yet. */
  rate?: Amount | null
  /** The date the rate is as of (YYYY-MM-DD). */
  rateOn?: string
  ageDays?: number
  /** v_fx_latest.staleness; derived from ageDays when omitted. */
  staleness?: FxStaleness | null
  /** The rate stored on the quote line when it was quoted. */
  captured?: { rate: Amount; on: string }
  className?: string
}

export function MoneyFx({ amount, currency, rate, rateOn, ageDays, staleness, captured, className }: MoneyFxProps) {
  const hasRate = rate !== null && rate !== undefined
  const band: FxStaleness | null = !hasRate ? null : (staleness ?? (ageDays !== undefined ? fxStaleness(ageDays) : 'fresh'))
  const original = (
    <span className="num whitespace-nowrap font-medium">
      <span className="mr-1 font-sans text-xs font-regular text-fg-muted">{currency}</span>
      {formatAmount(amount, 'always')}
    </span>
  )
  const note = 'num flex flex-wrap items-center gap-x-1 text-xs'

  let line: ReactNode
  if (captured) {
    const atTime = convertToPaisa(amount, captured.rate)
    line = (
      <span className={cn(note, 'text-fg-muted')}>
        <span>{`PKR ${formatPaisa(atTime)} at the time (${formatRate(captured.rate)})`}</span>
        {hasRate && band !== 'unusable' ? (
          <span>{`· ≈ PKR ${formatPaisa(convertToPaisa(amount, rate))} today (${formatRate(rate)})`}</span>
        ) : null}
      </span>
    )
  } else if (!hasRate) {
    line = (
      <>
        <span className="flex items-center gap-1 text-xs text-fg-muted">
          <Icon icon={Info} size="chip" />
          {`No ${currency} rate yet`}
        </span>
        <span
          data-quiet-chip=""
          className="inline-flex items-center gap-1 justify-self-start rounded-round bg-selected px-2 py-px text-xs leading-[18px] text-fg-muted"
        >
          <Icon icon={Info} size="chip" />
          not compared, no rate
        </span>
      </>
    )
  } else if (band === 'unusable') {
    line = (
      <span className={cn(note, 'text-tone-danger-fg')}>
        <Icon icon={CircleAlert} size="chip" />
        {`Rate ${ageDays ?? '30+'} days old · not compared`}
      </span>
    )
  } else if (band === 'stale') {
    line = (
      <span className={cn(note, 'text-tone-warning-fg')}>
        <Icon icon={Clock} size="chip" />
        {`≈ PKR ${formatPaisa(convertToPaisa(amount, rate))} at ${formatRate(rate)} · rate ${ageDays ?? '8 to 30'} days old`}
      </span>
    )
  } else {
    line = (
      <span className={cn(note, 'text-fg-muted')}>
        {`≈ PKR ${formatPaisa(convertToPaisa(amount, rate))} at ${formatRate(rate)}`}
        {rateOn ? ` · ${formatDay(rateOn)}` : ''}
      </span>
    )
  }

  return (
    <span className={cn('inline-grid gap-[2px]', className)} data-fx-band={band ?? 'none'}>
      {original}
      {line}
    </span>
  )
}

/*
 * NetGstGross: the three-cell figure for an order, quotation or invoice. Gross is
 * always net + GST, computed here in paisa. If the caller also passes the stored
 * gross and it disagrees, the stored figure is shown with a visible "does not add
 * up" flag rather than quietly replaced.
 */
export interface NetGstGrossProps {
  net: Amount
  gst: Amount
  /** Stored gross, if the source has one; checked against net + GST. */
  gross?: Amount | null
  /** GST rate for the label ("GST 18%"). Omit for mixed rates. */
  gstRate?: number
  size?: 'lg' | 'xl'
  className?: string
}

export function NetGstGross({ net, gst, gross, gstRate, size = 'lg', className }: NetGstGrossProps) {
  const sum = toPaisa(net) + toPaisa(gst)
  const mismatch = gross !== null && gross !== undefined && toPaisa(gross) !== sum
  const shown = mismatch ? toPaisa(gross) : sum
  const cell = 'grid min-w-0 gap-[2px] px-4 py-3'
  const label = 'text-xs font-medium text-fg-muted'
  return (
    <div
      role="group"
      aria-label="Net, GST and gross"
      data-mismatch={mismatch ? '' : undefined}
      className={cn('inline-grid grid-cols-3 gap-px overflow-hidden rounded border bg-line', className)}
    >
      <div className={cn(cell, 'bg-surface')}>
        <span className={label}>Net</span>
        <Money value={net} size={size} className="text-fg-2" />
      </div>
      <div className={cn(cell, 'bg-surface')}>
        <span className={label}>{gstRate !== undefined ? `GST ${gstRate}%` : 'GST'}</span>
        <Money value={gst} size={size} className="text-fg-2" />
      </div>
      <div className={cn(cell, 'bg-surface')}>
        <span className={label}>Gross</span>
        <Money value={paisaToFixed(shown)} size={size} strong />
        {mismatch ? (
          <span className="flex items-center gap-1 text-xs text-tone-warning-fg">
            <Icon icon={CircleAlert} size="chip" />
            Does not equal net + GST
          </span>
        ) : null}
      </div>
    </div>
  )
}
