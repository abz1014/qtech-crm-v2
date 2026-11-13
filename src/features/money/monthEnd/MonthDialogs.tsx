import { useState } from 'react'
import { CircleCheck, Info, Lock, LockOpen, TriangleAlert } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Field } from '@/ui/form/Field'
import { TextArea } from '@/ui/form/TextField'
import { Icon } from '@/ui/Icon'
import { useToast } from '@/ui/useToast'
import { monthKeyLabel } from '@/features/money/expenses/model'
import { useCloseMonth, useReopenMonth } from '@/features/money/monthEnd/hooks'
import { closeNeedsMove, monthName, type ClosedMonth } from '@/features/money/monthEnd/model'
import { lockChecks, lockChecksWithItems } from '@/features/money/monthEnd/lockChecks'
import { formatClosedAt, longDay } from '@/features/money/monthEnd/format'
import type { MonthEndCtx } from '@/features/money/monthEnd/useMonthEnd'

/*
 * Lock and reopen, each one confirmation (g2-month-end "Close confirmation" and "Reopen confirmation").
 * Lock October: the button (1), then "Lock October" here (2). Nothing is typed. Reopen: the list's button (1), this one (2); a reason is optional.
 * Owner decision 2026-10-22 (redesign, decision 5): months lock ONE AT A TIME, oldest first. The dialog closes exactly one month,
 * the month on screen, and only when no older open month comes first. Owner decision 2026-11-06: a month is locked only while it is
 * on screen; when another month would be locked, the page's button says "Go to <Month> <Year>" and moves there instead (no dialog).
 * There is no "close through".
 * A refusal from the database is shown in the dialog and nothing is changed.
 */
function closeFailure(err: unknown, month: string): string {
  const m = mapPgError(err, { entity: 'month' })
  if (m.kind === 'network') return m.message
  const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: string }).code : undefined
  if (code === '42501') return 'Only an admin can lock a month. Nothing was changed.'
  // A rule the server explains ("Close March 2024 first. Months close in order.") is said as written.
  if (code === 'P0001' && m.help) return `${m.message} Nothing was changed.`
  if (code === 'P0001') return `${monthKeyLabel(month)} could not be locked. Lock the earlier months first, or wait until the month has ended. Nothing was changed.`
  return 'The month was not locked. Try again.'
}

export function CloseMonthDialog({
  open,
  onOpenChange,
  ctx,
  mistakes = 0,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  ctx: MonthEndCtx
  /** How many mistakes to fix the page found (0 while they load, as on the page). */
  mistakes?: number
}) {
  const toast = useToast()
  const close = useCloseMonth()
  const [error, setError] = useState<string | null>(null)
  const state = ctx.state
  // The ONE month this closes: the month on screen. The page opens this dialog only when nothing older is open (otherwise its
  // button moves the page to the older month), and a dialog for any other month stays shut.
  const target = ctx.month
  const blocked = closeNeedsMove(ctx.month, state)
  const cards = lockChecks(ctx.cards, mistakes)
  const label = monthKeyLabel(target)
  const button = `Lock ${monthName(target)}`

  const confirm = () => {
    if (blocked) return
    setError(null)
    close.mutate(
      { month: target },
      {
        onSuccess: () => {
          onOpenChange(false)
          toast.toast({
            title: `${label} locked`,
            body: 'Payments, expenses and invoices dated in it are frozen.',
            tone: 'success',
          })
        },
        onError: e => setError(closeFailure(e, target)),
      },
    )
  }

  return (
    <Dialog
      open={open && !blocked}
      onOpenChange={o => {
        if (!o) setError(null)
        onOpenChange(o)
      }}
      busy={close.isPending}
    >
      <DialogContent
        title={`Lock ${label}?`}
        context={
          <>
            {longDay(ctx.today)} · <span className="num">{lockChecksWithItems(cards)}</span> of <span className="num">{cards.length}</span> checks have items
          </>
        }
        size="md"
        lead={`This locks ${label} only. Months lock one at a time, oldest first.`}
        footer={
          <>
            <Button data-cancel onClick={() => onOpenChange(false)} disabled={close.isPending}>
              Cancel
            </Button>
            <Button variant="primary" icon={Lock} onClick={confirm} busy={close.isPending}>
              {button}
            </Button>
          </>
        }
      >
        <ul aria-label="Warnings" className="grid overflow-hidden rounded-panel border bg-surface">
          {cards.map(c => (
            <li key={c.key} className="flex items-center gap-3 border-t px-4 py-[10px] first:border-t-0">
              <Icon icon={c.clear ? CircleCheck : TriangleAlert} size="md" className={c.clear ? 'text-tone-success-fg' : 'text-tone-warning-fg'} />
              <span className={c.clear ? 'text-fg-muted' : 'text-fg'}>
                {c.label}
                {c.clear ? null : <span className="text-xs text-fg-muted"> · {c.unit}</span>}
              </span>
              <span className="num ml-auto text-sm">{c.clear ? <span className="font-regular text-fg-muted">None</span> : c.n}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-start gap-3 rounded-row bg-sunken px-4 py-3 text-sm">
          <Icon icon={Info} className="mt-[2px] text-fg-muted" />
          <p>
            <span className="font-medium text-fg">These are warnings, not blockers.</span> Locking locks {label}: payments, expenses and invoices dated in it are
            frozen. No other month is changed. Bank matching and the TCS and FBR stamps stay editable. An admin can reopen {label} from the locked-months list.
          </p>
        </div>
        {error ? (
          <Banner tone="danger" title="The month was not locked">
            {error}
          </Banner>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export function ReopenMonthDialog({ entry, onClose }: { entry: ClosedMonth | null; onClose: () => void }) {
  const toast = useToast()
  const reopen = useReopenMonth()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const name = entry ? monthName(entry.key) : ''

  const confirm = () => {
    if (!entry) return
    setError(null)
    reopen.mutate(
      { month: entry.key, note },
      {
        onSuccess: () => {
          onClose()
          setNote('')
          toast.toast({ title: `${name} reopened`, body: 'It can be changed until it is locked again.', tone: 'success' })
        },
        onError: e => {
          const m = mapPgError(e, { entity: 'month' })
          // A rule the server explains (0080: months reopen newest first) is said as written; anything else stays generic.
          setError(m.kind === 'network' || m.help ? m.message : 'The month was not reopened. Try again.')
        },
      },
    )
  }

  return (
    <Dialog
      open={entry !== null}
      onOpenChange={o => {
        if (!o) {
          setError(null)
          onClose()
        }
      }}
      busy={reopen.isPending}
    >
      {entry ? (
        <DialogContent
          title={`Reopen ${monthKeyLabel(entry.key)}?`}
          context={`Locked ${formatClosedAt(entry.closedAt)}${entry.closedBy ? ` by ${entry.closedBy}` : ''}`}
          size="md"
          footer={
            <>
              <Button data-cancel onClick={onClose} disabled={reopen.isPending}>
                Cancel
              </Button>
              <Button variant="primary" icon={LockOpen} onClick={confirm} busy={reopen.isPending}>
                Reopen {name}
              </Button>
            </>
          }
        >
          <Field label="Reason, optional" help="Saved with the reopen in the audit log. Leave it empty to skip.">
            <TextArea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="For example: a supplier invoice arrived late" maxLength={500} />
          </Field>
          <Banner tone="warning" title={`${name} becomes editable again`}>
            Payments, expenses and invoices dated in {name} can be changed until it is locked a second time.
          </Banner>
          {error ? (
            <Banner tone="danger" title="The month was not reopened">
              {error}
            </Banner>
          ) : null}
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
