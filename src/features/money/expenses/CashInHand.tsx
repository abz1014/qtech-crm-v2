import { useState } from 'react'
import { ArrowDownToLine, Calculator, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Icon } from '@/ui/Icon'
import { InfoTip } from '@/ui/InfoTip'
import { useToast } from '@/ui/useToast'
import { NumberInput } from '@/ui/form/NumberInput'
import { useAddCashTopup, useCashInHand, useRecordCashCount } from '@/features/money/expenses/hooks'
import { pkr } from '@/features/money/expenses/model'
import type { CashInHand as CashState } from '@/features/money/expenses/claimsApi'

/*
 * Cash in hand (DATA_MODEL A9, owner: yes; 0087). One line, admin only: "Cash in hand: PKR 13,850 expected · counted Mon 19 Oct ·
 * Count cash". Expected = the last count (or the opening balance) + cash drawn from the bank since - cash expenses since. "Count
 * cash" records what is in the box; the database keeps what the books expected then, and the difference shows at once (short or
 * over). "Cash drawn" records cash taken from the bank into the box (not an expense). The first count is the opening balance.
 * Shown on Expenses and on Month end. 16 px text, 44 px taps.
 */
export function CashInHandLine({ compact = false }: { compact?: boolean }) {
  const q = useCashInHand()
  const [counting, setCounting] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const c = q.data
  if (q.isPending) return <div className="h-[60px] animate-pulse rounded border bg-sunken" aria-hidden="true" />
  if (q.isError || !c) return null
  const none = c.kind === 'none' || c.expected === null
  return (
    <section
      aria-label="Cash in hand"
      data-testid="cash-in-hand"
      className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 rounded border bg-surface px-4 py-3 text-base', compact && 'py-2')}
    >
      <Icon icon={Wallet} className="text-fg-muted" />
      {none ? (
        <span className="min-w-0 flex-1">
          <b className="font-semibold">Cash in hand</b> is not set up. Count the office cash once to start; after that the app works out what should be there.
        </span>
      ) : (
        <span className="min-w-0 flex-1" aria-live="polite">
          <b className="font-semibold">Cash in hand:</b> <b className="num font-semibold" data-testid="cash-expected">{pkr(c.expected ?? 0)}</b> expected
          <span className="text-fg-2">
            {' · '}
            {c.kind === 'opening' ? 'opening' : 'counted'} {c.baseOn ? formatShortDate(c.baseOn, businessToday()) : ''}
            {c.kind === 'count' && c.lastDifference !== null && c.lastDifference !== 0 ? (
              <span className={c.lastDifference < 0 ? 'text-tone-danger-fg' : 'text-tone-warning-fg'}>
                {' '}
                ({c.lastDifference < 0 ? 'short' : 'over'} {pkr(Math.abs(c.lastDifference))})
              </span>
            ) : null}
          </span>
          <InfoTip label="How cash in hand is worked out">
            {`${c.kind === 'opening' ? 'Opening balance' : 'Last count'} ${pkr(c.base)} + cash drawn from the bank since ${pkr(c.topups)} (${c.topupCount}) - cash expenses since ${pkr(c.cashOut)} (${c.cashOutCount}) = ${pkr(c.expected ?? 0)}. Cash drawn from the bank is not an expense.`}
          </InfoTip>
        </span>
      )}
      <span className="flex flex-wrap gap-2">
        {!none ? (
          <Button size="touch" icon={ArrowDownToLine} onClick={() => setDrawing(true)} className="text-base">
            Cash drawn
          </Button>
        ) : null}
        <Button size="touch" icon={Calculator} onClick={() => setCounting(true)} className="text-base">
          {none ? 'Set opening cash' : 'Count cash'}
        </Button>
      </span>
      {counting ? <CountDialog state={c} onClose={() => setCounting(false)} /> : null}
      {drawing ? <TopupDialog onClose={() => setDrawing(false)} /> : null}
    </section>
  )
}

function CountDialog({ state, onClose }: { state: CashState; onClose: () => void }) {
  const opening = state.kind === 'none' || state.expected === null
  const today = businessToday()
  const [counted, setCounted] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [on, setOn] = useState(today)
  const [id] = useState(() => crypto.randomUUID())
  const [error, setError] = useState<string | null>(null)
  const record = useRecordCashCount()
  const toast = useToast()
  const diff = !opening && counted !== null && state.expected !== null ? Math.round((counted - state.expected) * 100) / 100 : null
  const submit = () => {
    if (counted === null || counted < 0) {
      setError('Type what is in the box (0 if it is empty).')
      return
    }
    setError(null)
    record.mutate(
      { id, counted, note: note.trim() || null, opening: opening ? { on } : undefined },
      {
        onSuccess: r => {
          toast.toast({
            title: opening ? 'Opening cash set' : r.difference === null || r.difference === 0 ? 'Cash counted: it matches' : `Cash counted: ${r.difference < 0 ? 'short' : 'over'} ${pkr(Math.abs(r.difference))}`,
            body: pkr(counted),
            tone: r.difference ? 'neutral' : 'success',
          })
          onClose()
        },
        onError: e => setError(mapPgError(e, { entity: 'expense' }).message),
      },
    )
  }
  return (
    <Dialog open onOpenChange={o => !o && onClose()} busy={record.isPending} dirty={counted !== null}>
      <DialogContent
        title={opening ? 'Set opening cash' : 'Count cash'}
        context={opening ? 'The cash in the office box. From now on the app works out what should be there.' : `The books expect ${pkr(state.expected ?? 0)}.`}
        size="sm"
        footer={
          <>
            <Button variant="quiet" onClick={onClose} data-cancel className="text-base">
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} busy={record.isPending} busyLabel="Saving" className="text-base">
              {opening ? 'Set opening cash' : 'Save count'}
            </Button>
          </>
        }
      >
        <form
          className="grid gap-4 text-base"
          onSubmit={e => {
            e.preventDefault()
            submit()
          }}
        >
          <label className="grid gap-2">
            <span className="font-medium">Cash in the box, PKR</span>
            <NumberInput value={counted} onChange={setCounted} min={0} inputMode="decimal" autoFocus className="num h-12 text-lg" aria-label="Cash in the box, PKR" />
          </label>
          {opening ? (
            <label className="grid gap-2">
              <span className="font-medium">At the start of</span>
              <input type="date" value={on} max={today} onChange={e => e.target.value && setOn(e.target.value)} className="num min-h-touch rounded border border-line-input bg-surface px-3 text-base" />
            </label>
          ) : null}
          {diff !== null ? (
            <p className={cn('rounded px-3 py-2', diff === 0 ? 'bg-tone-success-bg text-tone-success-fg' : 'bg-tone-warning-bg text-tone-warning-fg')} aria-live="polite" data-testid="count-difference">
              {diff === 0 ? 'It matches the books.' : `${diff < 0 ? 'Short' : 'Over'} by ${pkr(Math.abs(diff))}. Check for a cash expense not recorded yet; the difference is kept with this count.`}
            </p>
          ) : null}
          <label className="grid gap-2">
            <span className="font-medium">
              Note <span className="font-regular text-fg-muted">optional</span>
            </span>
            <input value={note} maxLength={200} onChange={e => setNote(e.target.value)} className="min-h-touch rounded border border-line-input bg-surface px-3 text-base" />
          </label>
          {error ? (
            <p role="alert" className="text-tone-danger-fg">
              {error}
            </p>
          ) : null}
          <button type="submit" hidden tabIndex={-1} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TopupDialog({ onClose }: { onClose: () => void }) {
  const today = businessToday()
  const [amount, setAmount] = useState<number | null>(null)
  const [on, setOn] = useState(today)
  const [note, setNote] = useState('')
  const [id] = useState(() => crypto.randomUUID())
  const [error, setError] = useState<string | null>(null)
  const add = useAddCashTopup()
  const toast = useToast()
  const submit = () => {
    if (!amount || amount <= 0) {
      setError('Type the amount drawn.')
      return
    }
    setError(null)
    add.mutate(
      { id, amount, drawnOn: on, note: note.trim() || null },
      {
        onSuccess: () => {
          toast.toast({ title: 'Cash drawn recorded', body: `${pkr(amount)} into the office cash`, tone: 'success' })
          onClose()
        },
        onError: e => setError(mapPgError(e, { entity: 'expense' }).message),
      },
    )
  }
  return (
    <Dialog open onOpenChange={o => !o && onClose()} busy={add.isPending} dirty={amount !== null}>
      <DialogContent
        title="Cash drawn from the bank"
        context="Cash taken from the bank into the office box. It is not an expense."
        size="sm"
        footer={
          <>
            <Button variant="quiet" onClick={onClose} data-cancel className="text-base">
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} busy={add.isPending} busyLabel="Saving" className="text-base">
              Save
            </Button>
          </>
        }
      >
        <form
          className="grid gap-4 text-base"
          onSubmit={e => {
            e.preventDefault()
            submit()
          }}
        >
          <label className="grid gap-2">
            <span className="font-medium">Amount, PKR</span>
            <NumberInput value={amount} onChange={setAmount} min={0.01} inputMode="decimal" autoFocus className="num h-12 text-lg" aria-label="Amount drawn, PKR" />
          </label>
          <label className="grid gap-2">
            <span className="font-medium">Date</span>
            <input type="date" value={on} max={today} onChange={e => e.target.value && setOn(e.target.value)} className="num min-h-touch rounded border border-line-input bg-surface px-3 text-base" />
          </label>
          <label className="grid gap-2">
            <span className="font-medium">
              Note <span className="font-regular text-fg-muted">optional</span>
            </span>
            <input value={note} maxLength={200} onChange={e => setNote(e.target.value)} className="min-h-touch rounded border border-line-input bg-surface px-3 text-base" />
          </label>
          {error ? (
            <p role="alert" className="text-tone-danger-fg">
              {error}
            </p>
          ) : null}
          <button type="submit" hidden tabIndex={-1} />
        </form>
      </DialogContent>
    </Dialog>
  )
}
