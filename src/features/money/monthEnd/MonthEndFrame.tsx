import { useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { StatusBadge } from '@/ui/StatusBadge'
import { MoneyFrame } from '@/features/money/MoneyFrame'
import { MonthEndNav } from '@/features/money/monthEnd/MonthEndNav'
import { CloseMonthDialog } from '@/features/money/monthEnd/MonthDialogs'
import { closeButtonLabel, monthKeyShort, monthName } from '@/features/money/monthEnd/model'
import type { MonthEndCtx } from '@/features/money/monthEnd/useMonthEnd'

/*
 * What every Month-end view shares: the month in the address (?month=2026-10; last month when absent), the checklist counts, whether
 * the month is closed and whether it may be closed now, the frame (Money views, Month-end views) and the month bar under them
 * (g2-month-end "Report" tabs: the pager, the Open or Closed chip, "5 of 7 checks have items" and the close button).
 */
/** The Money frame with the Month-end views under it, counts and all. */
export function MonthEndFrame({ active, ctx, children, bankCount }: { active: string; ctx: MonthEndCtx; children: ReactNode; bankCount?: number }) {
  const bank = ctx.cards.find(c => c.key === 'bank_unticked')
  const counts: Partial<Record<string, number>> = {}
  if (ctx.statusReady) {
    counts.checklist = ctx.withItems
    counts.bank = bankCount ?? bank?.n
  }
  return (
    <MoneyFrame active="month-end">
      <MonthEndNav active={active} counts={counts} search={ctx.search} />
      {children}
    </MoneyFrame>
  )
}

/** Previous and next month, the month between them. Next stops at the current month. */
export function MonthPager({ month, thisMonth, go, label = 'Month' }: { month: string; thisMonth: string; go: (by: number) => void; label?: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-[2px] rounded bg-selected p-[2px]">
      <button
        type="button"
        aria-label="Previous month"
        onClick={() => go(-1)}
        className="inline-flex h-[26px] items-center rounded px-2 text-fg-muted transition-colors duration-fast hover:text-fg"
      >
        <Icon icon={ChevronLeft} size="sm" />
      </button>
      <span aria-live="polite" className="num inline-flex h-[26px] items-center rounded border border-line-strong bg-surface px-3 text-xs font-medium">
        {monthKeyShort(month)}
      </span>
      <button
        type="button"
        aria-label="Next month"
        disabled={month >= thisMonth}
        onClick={() => go(1)}
        className="inline-flex h-[26px] items-center rounded px-2 text-fg-muted transition-colors duration-fast hover:text-fg disabled:text-fg-disabled disabled:hover:text-fg-disabled"
      >
        <Icon icon={ChevronRight} size="sm" />
      </button>
    </div>
  )
}

export function MonthStateChip({ closed }: { closed: boolean }) {
  return <StatusBadge dimension="month" value={closed ? 'closed' : 'open'} />
}

/**
 * The strip under the Month-end views on every report: pager, state, how many checks have items, and the close button.
 * One tap opens the confirmation; the second closes the month.
 */
export function MonthBar({ ctx, className }: { ctx: MonthEndCtx; className?: string }) {
  const [open, setOpen] = useState(false)
  const isClosed = ctx.state?.kind === 'closed'
  const name = monthName(ctx.month)
  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <MonthPager month={ctx.month} thisMonth={ctx.thisMonth} go={ctx.go} />
      {ctx.state ? <MonthStateChip closed={isClosed} /> : null}
      {ctx.statusReady ? (
        <span className="text-xs text-fg-muted">
          <span className="num">{ctx.withItems}</span> of <span className="num">{ctx.cards.length}</span> checks have items
        </span>
      ) : null}
      <span className="flex-1" />
      {ctx.state && ctx.state.kind !== 'closed' ? (
        <>
          <Button
            variant="primary"
            icon={Lock}
            disabled={ctx.state.kind === 'not-ended'}
            title={ctx.state.kind === 'not-ended' ? `${name} can be closed once it has ended.` : undefined}
            onClick={() => setOpen(true)}
          >
            {closeButtonLabel(ctx.month, ctx.state)}
          </Button>
          <CloseMonthDialog open={open} onOpenChange={setOpen} ctx={ctx} />
        </>
      ) : isClosed ? (
        <span className="inline-flex items-center gap-2 text-xs text-fg-muted">
          <Icon icon={Lock} size="sm" />
          {name} is closed
        </span>
      ) : null}
    </div>
  )
}
