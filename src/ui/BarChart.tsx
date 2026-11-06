import { useId, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'

/*
 * BarChart: grouped vertical bars for a handful of series over 12 or 24 months, drawn as plain SVG (no chart library).
 *
 * Accessibility: the picture is ONE image for assistive tech (role="img", named by `summary`, which says the outcome in words);
 * the same figures are always available as a real table behind the "Show as a table" button, so nothing is only in the picture.
 * Nothing is drawn in the SVG itself except bars and one dashed reference line: every word on screen (the labels at both ends,
 * the highest value, the legend) is ordinary page text at 16px or more, so it never shrinks with the picture on a phone.
 * Bars are told apart by colour (dark, then brand green, 3:1 or more against the page) and by the legend.
 */
export interface BarSeries {
  name: string
  values: readonly number[]
}

export interface BarChartProps {
  /** One word or phrase per group, oldest first ("Nov 2025"). 12 or 24 for the Profitability page; any count from 1 works. */
  labels: readonly string[]
  /** One or two series, each with a value for every label. */
  series: readonly BarSeries[]
  /** The chart in one or two sentences, for the image's name ("Average 1.2 million a month; highest March 2026"). */
  summary: string
  /** Formats a value for the table and the labels (whole rupees). */
  format: (value: number) => string
  /** A dashed line across the chart, such as the average. */
  reference?: { label: string; value: number }
  /** Caption of the data table. */
  tableCaption: string
  /** The table starts open. */
  tableOpen?: boolean
  className?: string
}

const W = 720
const H = 220
const GAP = 4

const SHADES = ['fill-fg', 'fill-brand-green'] as const

export function BarChart({ labels, series, summary, format, reference, tableCaption, tableOpen = false, className }: BarChartProps) {
  const [open, setOpen] = useState(tableOpen)
  const tableId = useId()
  const all = series.flatMap(s => s.values)
  const top = Math.max(0, ...all, reference?.value ?? 0)
  const bottom = Math.min(0, ...all)
  const span = top - bottom || 1
  const y = (v: number) => ((top - v) / span) * H
  const zero = y(0)
  const groupW = W / Math.max(labels.length, 1)
  const barW = Math.max((groupW - GAP * 2) / Math.max(series.length, 1), 1)
  const highest = Math.max(...all, 0)
  return (
    <div className={cn('grid gap-3', className)} data-testid="bar-chart">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-base text-fg-2">
        <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
          {series.map((s, i) => (
            <li key={s.name} className="inline-flex items-center gap-2">
              <i aria-hidden="true" className={cn('inline-block size-4 rounded-[2px]', i === 0 ? 'bg-fg' : 'bg-brand-green')} />
              {s.name}
            </li>
          ))}
          {reference ? (
            <li className="inline-flex items-center gap-2">
              <i aria-hidden="true" className="inline-block h-0 w-4 border-t-2 border-dashed border-fg-2" />
              {reference.label}
            </li>
          ) : null}
        </ul>
        <span className="num">Highest {format(highest)}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={summary}
        preserveAspectRatio="none"
        className="h-[12rem] w-full overflow-visible"
        data-bars={labels.length * series.length}
      >
        <line x1={0} x2={W} y1={zero} y2={zero} className="stroke-line-strong" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {labels.map((label, g) =>
          series.map((s, k) => {
            const v = s.values[g] ?? 0
            const yy = Math.min(y(v), zero)
            const h = Math.max(Math.abs(y(v) - zero), v === 0 ? 0 : 1)
            return <rect key={`${label}-${s.name}`} x={g * groupW + GAP + k * barW} y={yy} width={Math.max(barW - 1, 1)} height={h} className={SHADES[k] ?? SHADES[1]} />
          }),
        )}
        {reference ? (
          <line x1={0} x2={W} y1={y(reference.value)} y2={y(reference.value)} className="stroke-fg-2" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>
      <div className="flex justify-between gap-4 text-base text-fg-2" aria-hidden="true">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
      <div>
        <Button size="sm" aria-expanded={open} aria-controls={tableId} onClick={() => setOpen(o => !o)}>
          {open ? 'Hide the table' : 'Show as a table'}
        </Button>
      </div>
      {open ? (
        <div id={tableId} className="overflow-x-auto rounded-panel border">
          <table className="w-full border-collapse text-base">
            <caption className="sr-only">{tableCaption}</caption>
            <thead>
              <tr className="bg-sunken text-left">
                <th scope="col" className="px-3 py-2 font-medium">
                  Month
                </th>
                {series.map(s => (
                  <th key={s.name} scope="col" className="px-3 py-2 text-right font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((label, g) => (
                <tr key={label} className="border-t">
                  <th scope="row" className="px-3 py-2 text-left font-regular">
                    {label}
                  </th>
                  {series.map(s => (
                    <td key={s.name} className="num px-3 py-2 text-right">
                      {format(s.values[g] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
