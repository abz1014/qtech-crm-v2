import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, CircleCheck, Clock, Copy } from 'lucide-react'
import { useSession } from '@/app/session'
import type { TeamMember } from '@/features/settings/api'
import { useAddTargets, useRemoveTargets, useSaveTarget, useTargetProgress, useTargets, useTeam } from '@/features/settings/hooks'
import {
  cellKey,
  cellProgress,
  checkTargetAmount,
  indexProgress,
  indexTargets,
  MAX_YEAR,
  MIN_YEAR,
  planCopy,
  QUARTERS,
  quarterLabel,
  quarterMonths,
  quarterOfDate,
  quarterPhase,
  quarterStartText,
  type ProgressRow,
  type Quarter,
  type TargetRow,
} from '@/features/settings/targetsModel'
import { roleLabel } from '@/features/settings/teamModel'
import { businessToday } from '@/lib/dates'
import { mapPgError } from '@/lib/pgErrors'
import { cn } from '@/lib/utils'
import { Avatar } from '@/ui/Avatar'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { Money } from '@/ui/Money'
import { Skeleton } from '@/ui/Skeleton'
import { Tag } from '@/ui/Tag'
import { useToast } from '@/ui/useToast'
import { Field } from '@/ui/form/Field'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'

/*
 * Settings › Targets (M06, admin only). People down the side, the four quarters of one calendar year across the top.
 * A target is NET cash received (GST left out). One tap on a cell opens it, the amount goes in, Enter saves: that is the
 * whole edit. Beside each target the grid shows what was achieved and where on-pace is, as rupee figures straight from
 * v_target_progress; a bare percentage is never shown. Each person sees only their own target, on Today.
 */
const COLS = 'grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(170px,1.1fr)_repeat(4,minmax(0,1fr))]'

export function TargetsPage() {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const today = useMemo(() => businessToday(), [])
  const now = quarterOfDate(today)
  const [year, setYear] = useState(now.year)
  const [into, setInto] = useState<Quarter>(year === now.year ? now.quarter : 1)
  const [editing, setEditing] = useState<{ userId: string; quarter: number } | null>(null)

  const team = useTeam(isAdmin)
  const targets = useTargets(year, isAdmin)
  const progress = useTargetProgress(year, isAdmin)
  const add = useAddTargets()
  const remove = useRemoveTargets()
  const { toast } = useToast()

  const people = useMemo(
    () => (team.data ?? []).filter(m => !m.deactivated_at).sort((a, b) => a.name.localeCompare(b.name)),
    [team.data],
  )
  const targetIdx = useMemo(() => indexTargets(targets.data ?? []), [targets.data])
  const progressIdx = useMemo(() => indexProgress(progress.data ?? []), [progress.data])
  const plan = useMemo(() => planCopy(people.map(p => p.id), targets.data ?? [], year, into), [people, targets.data, year, into])

  const loading = team.isPending || targets.isPending
  const failed = team.isError || targets.isError
  const retry = () => {
    void team.refetch()
    void targets.refetch()
    void progress.refetch()
  }

  const moveYear = (delta: number) => {
    const next = Math.min(MAX_YEAR, Math.max(MIN_YEAR, year + delta))
    setYear(next)
    setEditing(null)
    setInto(next === now.year ? now.quarter : 1)
  }

  const copy = async () => {
    const label = `${quarterLabel(plan.from.year, plan.from.quarter)} into ${quarterLabel(year, into)}`
    try {
      const added = await add.mutateAsync(plan.add)
      toast({
        title: `Copied ${quarterLabel(plan.from.year, plan.from.quarter)}`,
        body: `${added.length} ${added.length === 1 ? 'target' : 'targets'} added to ${quarterLabel(year, into)}`,
        tone: 'success',
        undo: {
          onUndo: async () => {
            await remove.mutateAsync(added.map(r => r.id))
          },
          settledTitle: `Copied ${label}`,
          undoneTitle: 'Copy undone.',
        },
      })
    } catch (err) {
      toast({ title: "Couldn't copy the targets", body: mapPgError(err, { entity: 'target' }).message, tone: 'danger', action: { label: 'Try again', onClick: () => void copy() } })
    }
  }

  const copyHint =
    plan.add.length > 0
      ? `Fills ${plan.add.length} empty ${plan.add.length === 1 ? 'cell' : 'cells'} in ${quarterLabel(year, into)} from ${quarterLabel(plan.from.year, plan.from.quarter)}. Targets already set stay as they are.`
      : `Nothing to copy: no one has a ${quarterLabel(plan.from.year, plan.from.quarter)} target that ${quarterLabel(year, into)} is missing.`

  return (
    <div className="grid content-start gap-4">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Targets</h1>
        <p className="max-w-prose text-sm text-fg-muted">
          Net cash received per person for each quarter, GST left out. Each person sees only their own target, on Today.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="flex items-center gap-1" role="group" aria-label="Year">
          <Button variant="secondary" icon={ChevronLeft} className="max-md:size-touch" aria-label="Previous year" disabled={year <= MIN_YEAR} onClick={() => moveYear(-1)} />
          <span className="num min-w-[4.5rem] text-center text-lg font-semibold" aria-live="polite" data-testid="targets-year">
            {year}
          </span>
          <Button variant="secondary" icon={ChevronRight} className="max-md:size-touch" aria-label="Next year" disabled={year >= MAX_YEAR} onClick={() => moveYear(1)} />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Copy into" className="w-[120px]">
            <Select
              value={String(into)}
              onChange={e => setInto(Number(e.target.value) as Quarter)}
              options={QUARTERS.map(q => ({ value: String(q), label: `Q${q} ${year}` }))}
            />
          </Field>
          <Button icon={Copy} onClick={() => void copy()} disabled={loading || plan.add.length === 0} busy={add.isPending} busyLabel="Copying">
            Copy last quarter
          </Button>
        </div>
        <p className="max-w-[44ch] basis-full text-xs text-fg-muted lg:basis-auto" aria-live="polite">
          {loading ? '' : copyHint}
        </p>
      </div>

      {progress.isError && !failed ? (
        <Banner tone="warning" title="Achieved and on-pace figures could not be read" action={<Button size="sm" onClick={retry}>Try again</Button>}>
          You can still set and change targets.
        </Banner>
      ) : null}

      {failed ? (
        <Banner tone="danger" title="Could not load targets" action={<Button size="sm" onClick={retry}>Try again</Button>}>
          {(targets.error ?? team.error) instanceof Error ? ((targets.error ?? team.error) as Error).message : 'Check your connection, then try again.'}
        </Banner>
      ) : loading ? (
        <div className="grid gap-px overflow-hidden rounded border bg-line" aria-busy="true" aria-label="Loading targets">
          {[0, 1, 2].map(i => (
            <div key={i} className="bg-surface p-4">
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      ) : people.length === 0 ? (
        <p className="rounded border px-6 py-10 text-center text-sm text-fg-muted">No one to set a target for yet. Add people on the Team screen.</p>
      ) : (
        <div role="table" aria-label={`Quarterly targets for ${year}`} className="overflow-hidden rounded border bg-surface">
          <div role="row" className={cn('grid border-b bg-sunken text-xs font-medium text-fg-muted max-md:sr-only', COLS)}>
            <div role="columnheader" className="px-4 py-2">Person</div>
            {QUARTERS.map(q => {
              const current = year === now.year && q === now.quarter
              return (
                <div key={q} role="columnheader" className="flex flex-wrap items-center gap-x-2 px-3 py-2">
                  <span className="text-fg">Q{q}</span>
                  <span>{quarterMonths(q)}</span>
                  {current ? <Tag>Now</Tag> : null}
                </div>
              )
            })}
          </div>
          {people.map(m => (
            <div key={m.id} role="row" className={cn('grid border-b last:border-b-0 max-md:gap-1 max-md:p-3', COLS)}>
              <div role="rowheader" className="flex min-w-0 items-center gap-3 md:px-4 md:py-3">
                <Avatar name={m.name} />
                <span className="grid min-w-0">
                  <span className="truncate text-sm font-medium">{m.name}</span>
                  <span className="truncate text-xs text-fg-muted">{roleLabel(m.role)}</span>
                </span>
              </div>
              {QUARTERS.map(q => (
                <TargetCell
                  key={q}
                  member={m}
                  year={year}
                  quarter={q}
                  target={targetIdx.get(cellKey(m.id, year, q))}
                  progress={progressIdx.get(cellKey(m.id, year, q))}
                  today={today}
                  editing={editing?.userId === m.id && editing.quarter === q}
                  onEdit={() => setEditing({ userId: m.id, quarter: q })}
                  onClose={() => setEditing(null)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      <p className="max-w-prose text-xs text-fg-muted">
        Achieved is net cash received and credited to the person in that quarter. On pace is the target spread evenly over the days of the quarter, counting today.
      </p>
    </div>
  )
}

interface CellProps {
  member: TeamMember
  year: number
  quarter: number
  target: TargetRow | undefined
  progress: ProgressRow | undefined
  today: string
  editing: boolean
  onEdit: () => void
  onClose: () => void
}

function TargetCell({ member, year, quarter, target, progress, today, editing, onEdit, onClose }: CellProps) {
  const phase = quarterPhase(year, quarter, today)
  const current = phase === 'current'
  const p = cellProgress(target, progress, phase)
  const what = `${member.name}, ${quarterLabel(year, quarter)}`
  return (
    <div
      role="cell"
      data-cell={`${member.id}:${quarter}`}
      className={cn('grid content-start gap-1 md:px-3 md:py-3', current && 'md:bg-selected/40', 'max-md:grid-cols-[3rem_minmax(0,1fr)] max-md:items-start')}
    >
      <span className="pt-2 text-xs font-medium text-fg-muted md:hidden" aria-hidden="true">Q{quarter}</span>
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
            {target ? <Money value={target.target_net_pkr} className="text-fg" /> : <span>Set target</span>}
          </button>
        )}
        {!editing ? <Progress p={p} year={year} quarter={quarter} /> : null}
      </div>
    </div>
  )
}

function Progress({ p, year, quarter }: { p: ReturnType<typeof cellProgress>; year: number; quarter: number }) {
  if (p.kind === 'none') {
    return p.achieved > 0 ? (
      <p className="px-1 text-right text-xs text-fg-muted">
        Achieved <Money value={p.achieved} className="text-fg-2" />, no target
      </p>
    ) : null
  }
  if (p.kind === 'not-started') return <p className="px-1 text-right text-xs text-fg-muted">Starts {quarterStartText(year, quarter)}</p>
  const behind = p.ahead < 0
  return (
    <div className="grid gap-[2px] px-1 text-right text-xs">
      <p className="text-fg-muted">
        Achieved <Money value={p.achieved} className="text-fg" />
      </p>
      <p className="text-fg-muted">
        On pace <Money value={p.onPace} className="text-fg-2" />
      </p>
      {p.ahead === 0 ? (
        <p className="inline-flex items-center justify-end gap-1 text-tone-success-fg">
          <Icon icon={CircleCheck} size="chip" /> On pace
        </p>
      ) : (
        <p className={cn('inline-flex flex-wrap items-center justify-end gap-x-1', behind ? 'text-tone-warning-fg' : 'text-tone-success-fg')}>
          <Icon icon={behind ? Clock : CircleCheck} size="chip" />
          <Money value={Math.abs(p.ahead)} className="[&_span]:text-inherit" /> {behind ? 'behind pace' : 'ahead of pace'}
        </p>
      )}
      {p.excluded > 0 ? (
        <p className="text-fg-muted">
          {p.excluded} {p.excluded === 1 ? 'payment is' : 'payments are'} not counted yet
        </p>
      ) : null}
    </div>
  )
}

function CellEditor({ member, year, quarter, target, what, onClose }: Pick<CellProps, 'member' | 'year' | 'quarter' | 'target' | 'onClose'> & { what: string }) {
  const save = useSaveTarget()
  const remove = useRemoveTargets()
  const { toast } = useToast()
  const [value, setValue] = useState<number | null>(target?.target_net_pkr ?? null)
  const [error, setError] = useState<string | null>(null)
  const finished = useRef(false)
  const busy = save.isPending || remove.isPending
  const errId = `err-${member.id}-${quarter}`

  const finish = () => {
    finished.current = true
    onClose()
  }

  /** Enter saves. Blur saves too when the value is good and changed; otherwise it simply closes. */
  const commit = async (fromBlur: boolean) => {
    if (finished.current || busy) return
    const before = target?.target_net_pkr ?? null
    if (value === before) return finish()

    if (value === null) {
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

    const check = checkTargetAmount(value)
    if (!check.ok) {
      if (fromBlur) return finish()
      return setError(check.message)
    }
    finished.current = true
    try {
      await save.mutateAsync({ userId: member.id, year, quarter, amount: check.amount })
      onClose()
      toast({ title: 'Target saved', body: `${what}: PKR ${new Intl.NumberFormat('en-US').format(check.amount)}`, tone: 'success' })
    } catch (err) {
      finished.current = false
      setError(mapPgError(err, { entity: 'target' }).message)
    }
  }

  return (
    <div className="grid gap-1">
      <NumberInput
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
        <p id={errId} role="alert" className="text-xs text-tone-danger-fg">
          {error}
        </p>
      ) : (
        <p className="px-1 text-right text-xs text-fg-muted max-md:hidden">Enter saves. Empty removes. Esc cancels.</p>
      )}
    </div>
  )
}
