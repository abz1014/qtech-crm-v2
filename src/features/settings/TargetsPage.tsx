import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy } from 'lucide-react'
import { useSession } from '@/app/session'
import type { TeamMember } from '@/features/settings/api'
import { useAddTargets, useRemoveTargets, useSaveTarget, useTargetProgress, useTargets, useTeam } from '@/features/settings/hooks'
import {
  cellIntent,
  cellKey,
  cellProgress,
  checkTargetAmount,
  indexProgress,
  indexTargets,
  MAX_YEAR,
  MIN_YEAR,
  planCopy,
  previousQuarter,
  progressLine,
  quarterLabel,
  quarterMonths,
  quarterOfDate,
  quarterPhase,
  quarterStartText,
  shownQuarters,
  targetsFooter,
  type ProgressRow,
  type QuarterRef,
  type TargetRow,
} from '@/features/settings/targetsModel'
import { roleLabel } from '@/features/settings/teamModel'
import { businessToday } from '@/lib/dates'
import { pkr } from '@/lib/formRules'
import { mapPgError } from '@/lib/pgErrors'
import { cn } from '@/lib/utils'
import { Avatar } from '@/ui/Avatar'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { InfoTip } from '@/ui/InfoTip'
import { PageHeader } from '@/ui/PageHeader'
import { Money } from '@/ui/Money'
import { Skeleton } from '@/ui/Skeleton'
import { ProgressBar, Tag } from '@/ui/Tag'
import { useToast } from '@/ui/useToast'
import { NumberInput } from '@/ui/form/NumberInput'

/*
 * Settings › Targets (M06, admin only). People down the side, quarters across the top. A target is NET cash received (GST
 * left out). One tap on a cell opens it, the amount goes in, Enter saves: that is the whole edit. Under each target one line
 * says what was achieved against it and how far ahead of or behind pace, with a small bar (the tick is where on pace is), as
 * rupee figures straight from v_target_progress; a bare percentage is never shown. Each person sees only their own, on Today.
 *
 * Audit 2026-10-22: the grid opens on this quarter and the next only ("Show earlier quarters" brings back a year of four), so
 * quarters already over are not a wall of empty boxes; "Copy last quarter" appears only when there is something to copy; an
 * engineer's empty cell says "No target" (engineers carry no sales target unless one is set on purpose).
 */
const COLS: Record<number, string> = {
  2: 'grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(170px,1.1fr)_repeat(2,minmax(0,1fr))]',
  4: 'grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(170px,1.1fr)_repeat(4,minmax(0,1fr))]',
}

export function TargetsPage() {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const today = useMemo(() => businessToday(), [])
  const now = quarterOfDate(today)
  const [mode, setMode] = useState<'now' | 'year'>('now')
  const [year, setYear] = useState(now.year)
  const [editing, setEditing] = useState<{ userId: string; year: number; quarter: number } | null>(null)

  const quarters = useMemo(() => shownQuarters(mode, today, year), [mode, today, year])
  // The years to read: those shown, and the one before the first (so Q1 can be copied from last year's Q4). At most two.
  const firstPrev = previousQuarter(quarters[0].year, quarters[0].quarter)
  const yearA = firstPrev.year
  const yearB = quarters[quarters.length - 1].year

  const team = useTeam(isAdmin)
  const targetsA = useTargets(yearA, isAdmin)
  const targetsB = useTargets(yearB, isAdmin)
  const progressA = useTargetProgress(yearA, isAdmin)
  const progressB = useTargetProgress(yearB, isAdmin)
  const add = useAddTargets()
  const remove = useRemoveTargets()
  const { toast } = useToast()

  const allTargets = useMemo(
    () => (yearA === yearB ? (targetsB.data ?? []) : [...(targetsA.data ?? []), ...(targetsB.data ?? [])]),
    [yearA, yearB, targetsA.data, targetsB.data],
  )
  const allProgress = useMemo(
    () => (yearA === yearB ? (progressB.data ?? []) : [...(progressA.data ?? []), ...(progressB.data ?? [])]),
    [yearA, yearB, progressA.data, progressB.data],
  )
  const people = useMemo(() => (team.data ?? []).filter(m => !m.deactivated_at).sort((a, b) => a.name.localeCompare(b.name)), [team.data])
  const targetIdx = useMemo(() => indexTargets(allTargets), [allTargets])
  const progressIdx = useMemo(() => indexProgress(allProgress), [allProgress])

  // Copy last quarter: into the first shown quarter that is not over and has empty cells to fill. Nothing to copy: no control.
  const plan = useMemo(() => {
    for (const q of quarters) {
      if (quarterPhase(q.year, q.quarter, today) === 'past') continue
      const p = planCopy(people.map(m => m.id), allTargets, q.year, q.quarter)
      if (p.add.length > 0) return p
    }
    return null
  }, [quarters, people, allTargets, today])

  const loading = team.isPending || targetsA.isPending || targetsB.isPending
  const failed = team.isError || targetsA.isError || targetsB.isError
  const progressFailed = progressA.isError || progressB.isError
  const retry = () => {
    void team.refetch()
    void targetsA.refetch()
    void targetsB.refetch()
    void progressA.refetch()
    void progressB.refetch()
  }

  const moveYear = (delta: number) => {
    setYear(Math.min(MAX_YEAR, Math.max(MIN_YEAR, year + delta)))
    setEditing(null)
  }

  const copy = async () => {
    if (!plan) return
    const from = quarterLabel(plan.from.year, plan.from.quarter)
    const into = quarterLabel(plan.into.year, plan.into.quarter)
    try {
      const added = await add.mutateAsync(plan.add)
      toast({
        title: `Copied ${from}`,
        body: `${added.length} ${added.length === 1 ? 'target' : 'targets'} added to ${into}`,
        tone: 'success',
        undo: {
          onUndo: async () => {
            await remove.mutateAsync(added.map(r => r.id))
          },
          settledTitle: `Copied ${from} into ${into}`,
          undoneTitle: 'Copy undone.',
        },
      })
    } catch (err) {
      toast({ title: "Couldn't copy the targets", body: mapPgError(err, { entity: 'target' }).message, tone: 'danger', action: { label: 'Try again', onClick: () => void copy() } })
    }
  }

  const cols = COLS[quarters.length]
  const footerQuarter = mode === 'now' ? now.quarter : year === now.year ? now.quarter : null

  return (
    <div className="grid content-start gap-4">
      <PageHeader
        title="Targets"
        lede={
          <>
            Each person sees only their own target, on Today.{' '}
            <InfoTip label="About targets">
              Per person, per quarter, in net cash received (GST left out). Achieved is net cash received and credited to the person in
              that quarter. On pace is the target spread evenly over the days of the quarter, counting today (the tick on the bar).
              Engineers carry no sales target unless you set one.
            </InfoTip>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {mode === 'year' ? (
          <div className="flex items-center gap-1" role="group" aria-label="Year">
            <Button variant="secondary" icon={ChevronLeft} className="max-md:h-touch max-md:w-touch" aria-label="Previous year" disabled={year <= MIN_YEAR} onClick={() => moveYear(-1)} />
            <span className="num min-w-[4.5rem] text-center text-lg font-semibold" aria-live="polite" data-testid="targets-year">
              {year}
            </span>
            <Button variant="secondary" icon={ChevronRight} className="max-md:h-touch max-md:w-touch" aria-label="Next year" disabled={year >= MAX_YEAR} onClick={() => moveYear(1)} />
          </div>
        ) : null}
        <Button
          variant="quiet"
          className="max-md:h-touch"
          onClick={() => {
            setMode(mode === 'now' ? 'year' : 'now')
            setYear(now.year)
            setEditing(null)
          }}
        >
          {mode === 'now' ? 'Show earlier quarters' : 'Show this quarter and next only'}
        </Button>
        {plan && !loading ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button icon={Copy} className="max-md:h-touch" onClick={() => void copy()} busy={add.isPending} busyLabel="Copying">
              Copy last quarter
            </Button>
            <p className="text-sm text-fg-muted" aria-live="polite">
              {`Fills ${plan.add.length} empty ${plan.add.length === 1 ? 'cell' : 'cells'} in ${quarterLabel(plan.into.year, plan.into.quarter)} from ${quarterLabel(plan.from.year, plan.from.quarter)}.`}
            </p>
          </div>
        ) : null}
      </div>

      {progressFailed && !failed ? (
        <Banner tone="warning" title="Achieved and on-pace figures could not be read" action={<Button size="sm" onClick={retry}>Try again</Button>}>
          You can still set and change targets.
        </Banner>
      ) : null}

      {failed ? (
        <Banner tone="danger" title="Could not load targets" action={<Button size="sm" onClick={retry}>Try again</Button>}>
          {(targetsA.error ?? targetsB.error ?? team.error) instanceof Error ? ((targetsA.error ?? targetsB.error ?? team.error) as Error).message : 'Check your connection, then try again.'}
        </Banner>
      ) : loading ? (
        <div role="status" className="grid gap-px overflow-hidden rounded-panel border bg-line" aria-busy="true" aria-label="Loading targets">
          {[0, 1, 2].map(i => (
            <div key={i} className="bg-surface p-4">
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      ) : people.length === 0 ? (
        <p className="rounded border px-6 py-10 text-center text-sm text-fg-muted">No one to set a target for yet. Add people on the Team screen.</p>
      ) : (
        <div
          role="table"
          aria-label={mode === 'now' ? 'Quarterly targets, this quarter and next' : `Quarterly targets for ${year}`}
          className="overflow-hidden rounded-panel border bg-surface"
        >
          <div role="row" className={cn('grid border-b bg-sunken text-sm font-medium text-fg-muted max-md:sr-only', cols)}>
            <div role="columnheader" className="px-4 py-2">
              Person
            </div>
            {quarters.map(q => {
              const current = q.year === now.year && q.quarter === now.quarter
              return (
                <div key={`${q.year}-${q.quarter}`} role="columnheader" className="flex flex-wrap items-center gap-x-2 px-3 py-2">
                  <span className="text-fg">{quarterLabel(q.year, q.quarter)}</span>
                  <span>{quarterMonths(q.quarter)}</span>
                  {current ? <Tag>Now</Tag> : null}
                </div>
              )
            })}
          </div>
          {people.map(m => (
            <div key={m.id} role="row" className={cn('grid border-b last:border-b-0 max-md:gap-1 max-md:p-3', cols)}>
              <div role="rowheader" className="flex min-w-0 items-center gap-3 md:px-4 md:py-3">
                <Avatar name={m.name} />
                <span className="grid min-w-0">
                  <span className="min-w-0 [overflow-wrap:anywhere] text-sm font-medium">{m.name}</span>
                  <span className="text-sm text-fg-muted">{roleLabel(m.role)}</span>
                </span>
              </div>
              {quarters.map(q => (
                <TargetCell
                  key={`${q.year}-${q.quarter}`}
                  member={m}
                  q={q}
                  target={targetIdx.get(cellKey(m.id, q.year, q.quarter))}
                  progress={progressIdx.get(cellKey(m.id, q.year, q.quarter))}
                  today={today}
                  editing={editing?.userId === m.id && editing.year === q.year && editing.quarter === q.quarter}
                  onEdit={() => setEditing({ userId: m.id, year: q.year, quarter: q.quarter })}
                  onClose={() => setEditing(null)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      {!loading && !failed && people.length > 0 ? (
        <p className="text-sm text-fg-muted" data-testid="targets-footer">
          {targetsFooter(people.map(p => p.id), allTargets, mode === 'now' ? now.year : year, footerQuarter)}
        </p>
      ) : null}
    </div>
  )
}

interface CellProps {
  member: TeamMember
  q: QuarterRef
  target: TargetRow | undefined
  progress: ProgressRow | undefined
  today: string
  editing: boolean
  onEdit: () => void
  onClose: () => void
}

function TargetCell({ member, q, target, progress, today, editing, onEdit, onClose }: CellProps) {
  const { year, quarter } = q
  const phase = quarterPhase(year, quarter, today)
  const current = phase === 'current'
  const p = cellProgress(target, progress, phase)
  const what = `${member.name}, ${quarterLabel(year, quarter)}`
  return (
    <div
      role="cell"
      data-cell={`${member.id}:${quarter}`}
      className={cn('grid content-start gap-1 md:px-3 md:py-3', current && 'md:bg-selected/40', 'max-md:grid-cols-[4.5rem_minmax(0,1fr)] max-md:items-start')}
    >
      <span className="pt-3 text-sm font-medium text-fg-muted md:hidden" aria-hidden="true">
        {quarterLabel(year, quarter)}
      </span>
      <div className="grid min-w-0 content-start gap-1">
        {editing ? (
          <CellEditor member={member} year={year} quarter={quarter} target={target} what={what} onClose={onClose} />
        ) : (
          <button
            type="button"
            onClick={onEdit}
            className={cn(
              'flex h-control min-w-0 items-center justify-end rounded border px-3 text-sm max-md:h-touch',
              target ? 'border-transparent hover:border-line-input hover:bg-sunken' : 'border-dashed border-line-input text-fg-muted hover:bg-sunken',
            )}
          >
            {/* The name is the visible text with the person and quarter in front, so what is read out contains what is shown. */}
            <span className="sr-only">{what} target: </span>
            {target ? <Money value={target.target_net_pkr} className="text-fg" /> : <span>{member.role === 'engineer' ? 'No target' : 'Set target'}</span>}
          </button>
        )}
        {!editing ? <Progress p={p} target={target} year={year} quarter={quarter} /> : null}
      </div>
    </div>
  )
}

function Progress({ p, target, year, quarter }: { p: ReturnType<typeof cellProgress>; target: TargetRow | undefined; year: number; quarter: number }) {
  if (p.kind === 'none') {
    return p.achieved > 0 ? (
      <p className="px-1 text-right text-sm text-fg-muted">
        Achieved <Money value={p.achieved} className="text-fg-2" />, no target
      </p>
    ) : null
  }
  if (p.kind === 'not-started') return <p className="px-1 text-right text-sm text-fg-muted">Starts {quarterStartText(year, quarter)}</p>
  const amount = Number(target?.target_net_pkr ?? 0)
  const behind = p.ahead < 0
  return (
    <div className="grid gap-1 px-1">
      <p className={cn('text-right text-sm', p.ahead === 0 ? 'text-fg-2' : behind ? 'text-tone-warning-fg' : 'text-tone-success-fg')}>
        <span className="num">{progressLine(p, amount)}</span>
      </p>
      <ProgressBar
        done={p.achieved}
        total={amount}
        marker={amount > 0 ? Math.min(100, Math.max(0, (p.onPace / amount) * 100)) : undefined}
        label={`Achieved ${p.achieved} of ${amount}; on pace is ${p.onPace}`}
      />
      {p.excluded > 0 ? (
        <p className="text-right text-sm text-fg-muted">
          {p.excluded} {p.excluded === 1 ? 'payment is' : 'payments are'} not counted yet
        </p>
      ) : null}
    </div>
  )
}
function CellEditor({ member, year, quarter, target, what, onClose }: Pick<CellProps, 'member' | 'target' | 'onClose'> & { year: number; quarter: number; what: string }) {
  const save = useSaveTarget()
  const remove = useRemoveTargets()
  const { toast } = useToast()
  const [value, setValue] = useState<number | null>(target?.target_net_pkr ?? null)
  const [error, setError] = useState<string | null>(null)
  const finished = useRef(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const busy = save.isPending || remove.isPending
  const errId = `err-${member.id}-${quarter}`

  const finish = () => {
    finished.current = true
    onClose()
  }

  /** Blur with something unusable typed: the target is kept, and the person is told why nothing changed. */
  const keepWithNote = (message: string) => {
    finish()
    toast({ title: 'Target not changed', body: `${what}: ${message}`, tone: 'neutral' })
  }

  /**
   * Enter saves. Blur saves too when the value is good and changed. Only a really empty cell removes (Enter); text that
   * is not an amount never does (hunt HE-12): Enter shows why, blur closes and says the target was kept.
   */
  const commit = async (fromBlur: boolean) => {
    if (finished.current || busy) return
    const intent = cellIntent(inputRef.current?.value ?? '', value)
    if (intent.kind === 'unreadable') return fromBlur ? keepWithNote(intent.message) : setError(intent.message)
    const typed = intent.kind === 'amount' ? intent.value : null
    const before = target?.target_net_pkr ?? null
    if (typed === before) return finish()

    if (typed === null) {
      if (!target) return finish()
      if (fromBlur) return finish() // an emptied cell is only removed by pressing Enter
      finished.current = true
      try {
        await remove.mutateAsync([target.id])
        onClose()
        toast({
          title: 'Target removed',
          body: `${what}`,
          undo: {
            onUndo: async () => {
              await save.mutateAsync({ userId: member.id, year, quarter, amount: target.target_net_pkr })
            },
            settledTitle: 'Target removed',
            undoneTitle: 'Target put back.',
          },
        })
      } catch (err) {
        finished.current = false
        setError(mapPgError(err, { entity: 'target' }).message)
      }
      return
    }

    const check = checkTargetAmount(typed)
    if (!check.ok) return fromBlur ? keepWithNote(check.message) : setError(check.message)
    finished.current = true
    try {
      await save.mutateAsync({ userId: member.id, year, quarter, amount: check.amount })
      onClose()
      toast({ title: 'Target saved', body: `${what}: ${pkr(check.amount)}`, tone: 'success' })
    } catch (err) {
      finished.current = false
      setError(mapPgError(err, { entity: 'target' }).message)
    }
  }

  return (
    <div className="grid gap-1">
      <NumberInput
        ref={inputRef}
        autoFocus
        aria-label={`${what} target in rupees`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        prefix="PKR"
        placeholder="Amount"
        value={value}
        disabled={busy}
        onChange={v => {
          setValue(v)
          setError(null)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit(false)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            finish()
          }
        }}
        onBlur={() => void commit(true)}
      />
      {error ? (
        <p id={errId} role="alert" className="text-sm text-tone-danger-fg">
          {error}
        </p>
      ) : (
        <p className="px-1 text-right text-sm text-fg-muted max-md:hidden">Enter saves. Empty removes. Esc cancels.</p>
      )}
    </div>
  )
}
