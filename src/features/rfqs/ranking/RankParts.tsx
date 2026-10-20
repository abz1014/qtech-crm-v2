import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Banknote,
  Check,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock,
  FileCheck,
  History,
  Info,
  Plus,
  Scale,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import type { Reason, ReasonIcon, ReasonSet } from '@/features/rfqs/lib/ranking/reasons'

/*
 * The pieces of the ranked comparison (R25; g2-ranking-split; reworked by the UX audit of 2026-10-19). The reasons under a
 * supplier's price, shown when the person opens the row (rows start closed, and the one "Recommended" mark and the panel's tip say
 * the rest). Every string comes from lib/ranking/reasons.ts; this file only lays them out.
 */

const ICONS: Record<ReasonIcon, LucideIcon> = {
  best: Check,
  gap: ArrowRight,
  band: Scale,
  spread: Banknote,
  'sell-none': Info,
  'on-time': CircleCheck,
  late: TriangleAlert,
  few: CircleDashed,
  'none-yet': CircleDashed,
  history: History,
  evidence: FileCheck,
  rate: Clock,
  unranked: CircleAlert,
}

/** A reason's words, with its figures, dates and order numbers in the figure face. */
export function ReasonParts({ reason }: { reason: Reason }) {
  return (
    <>
      {reason.parts.map((p, i) => (p.num ? <span key={i} className="num text-fg">{p.text}</span> : <span key={i}>{p.text}</span>))}
    </>
  )
}

/** The reasons for one supplier, as a list. `unrankedCurrency` adds the "Add CNY rate" link of a line that could not be ranked. */
export function ReasonBlock({ set, unrankedCurrency, supplier }: { set: ReasonSet; unrankedCurrency?: string | null; supplier: string }) {
  return (
    <div className="grid gap-1" data-reasons-for={supplier}>
      <ul className="mt-[2px] grid gap-[6px] rounded-r border-l-2 border-line-strong bg-sunken px-3 py-2" data-reasons="full">
        {set.full.map((r, i) => (
          <li
            key={r.id + i}
            data-reason={r.id}
            className={cn('grid grid-cols-[14px_minmax(0,1fr)] gap-2 text-sm text-fg-2', r.id === 'evidence' && 'text-fg-muted', r.tone === 'warn' && 'text-tone-warning-fg')}
          >
            <Icon icon={ICONS[r.icon]} size="chip" className={cn('mt-[3px]', r.tone === 'warn' ? 'text-tone-warning-fg' : 'text-fg-muted')} />
            <span className="text-pretty">
              <ReasonParts reason={r} />
            </span>
          </li>
        ))}
      </ul>
      {unrankedCurrency ? (
        <Link
          to="/settings/exchange-rates"
          className="inline-flex h-control w-fit items-center gap-1 rounded border border-line-strong bg-surface px-2 text-sm font-medium hover:bg-sunken"
        >
          <Icon icon={Plus} size="sm" />
          {`Add ${unrankedCurrency} rate`}
        </Link>
      ) : null}
    </div>
  )
}
