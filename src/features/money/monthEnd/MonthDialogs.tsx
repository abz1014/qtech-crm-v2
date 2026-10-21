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
import { monthName, type ClosedMonth } from '@/features/money/monthEnd/model'
import { formatClosedAt, longDay } from '@/features/money/monthEnd/format'
import type { MonthEndCtx } from '@/features/money/monthEnd/useMonthEnd'

/*
 * Close and reopen, each one confirmation (g2-month-end "Close confirmation" and "Reopen confirmation").
 * Close October: the button (1), then "Close October" here (2). Nothing is typed. Reopen: the list's button (1), this one (2); a reason is optional.
 * A refusal from the database is shown in the dialog and nothing is changed.
 */
function closeFailure(err: unknown, month: string): string {
  const m = mapPgError(err, { entity: 'month' })
  if (m.kind === 'network') return m.message
  const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: string }).code : undefined
  if (code === '42501') return 'Only an admin can close a month. Nothing was changed.'
  if (code === 'P0001') return `${monthKeyLabel(month)} could not be closed. Close the earlier months first, or wait until the month has ended. Nothing was changed.`
  return 'Something went wrong. The month was not closed. Try again.'
}

export function CloseMonthDialog({ open, onOpenChange, ctx }: { open: boolean; onOpenChange: (o: boolean) => void; ctx: MonthEndCtx }) {
  const toast = useToast()
  const close = useCloseMonth()
  const [error, setError] = useState<string | null>(null)
  const state = ctx.state
  const through = state?.kind === 'open' && state.through
  const name = monthName(ctx.month)

  const confirm = () => {
    setError(null)
    close.mutate(
      { month: ctx.month, through },
      {
        onSuccess: () => {
          onOpenChange(false)
          toast.toast({
            title: `${name} closed`,
            body: through ? 'The earlier open months are closed with it.' : 'Payments, expenses and invoices dated in it are frozen.',
            tone: 'success',
          })
        },
        onError: e => setError(closeFailure(e, ctx.month)),
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={o => {
        if (!o) setError(null)
        onOpenChange(o)
      }}
      busy={close.isPending}
    >
      <DialogContent
        title={`Close ${monthKeyLabel(ctx.month)}?`}
        context={
          <>
            {longDay(ctx.today)} · <span className="num">{ctx.withItems}</span> of <span className="num">{ctx.cards.length}</span> checks have items
          </>
        }
        size="md"
        lead={`If an earlier month is still open, this button reads “Close through ${name}”.`}
        footer={
          <>
            <Button data-cancel onClick={() => onOpenChange(false)} disabled={close.isPending}>
              Cancel
            </Button>
            <Button variant="primary" icon={Lock} onClick={confirm} busy={close.isPending}>
              {through ? `Close through ${name}` : `Close ${name}`}
            </Button>
          </>
        }
      >
        <ul aria-label="Warnings" className="grid overflow-hidden rounded border bg-surface">
          {ctx.cards.map(c => (
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
        {through && state?.kind === 'open' ? (
          <Banner tone="warning" title="Earlier months are still open">
            {state.earlier.map(monthKeyLabel).join(', ')} {state.earlier.length === 1 ? 'is' : 'are'} closed with {name}, in this one step.
          </Banner>
        ) : null}
        <div className="flex items-start gap-3 rounded bg-sunken px-4 py-3 text-sm">
          <Icon icon={Info} className="mt-[2px] text-fg-muted" />
          <p>
            <span className="font-medium text-fg">These are warnings, not blockers.</span> Closing freezes payments, expenses and invoices dated in {name}. Bank matching and the TCS and FBR stamps stay
            editable. An admin can reopen {name} from the closed-months list.
          </p>
        </div>
        {error ? (
          <Banner tone="danger" title="The month was not closed">
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
          toast.toast({ title: `${name} reopened`, body: 'It can be changed until you close it again.', tone: 'success' })
        },
        onError: e => {
          const m = mapPgError(e, { entity: 'month' })
          // A rule the server explains (0080: months reopen newest first) is said as written; anything else stays generic.
          setError(m.kind === 'network' || m.help ? m.message : 'Something went wrong. The month was not reopened. Try again.')
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
          context={`Closed ${formatClosedAt(entry.closedAt)}${entry.closedBy ? ` by ${entry.closedBy}` : ''}`}
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
            Payments, expenses and invoices dated in {name} can be changed until you close it a second time.
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
