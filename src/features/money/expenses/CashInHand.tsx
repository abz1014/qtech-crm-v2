import { useId, useState } from 'react'
import { ArrowDownToLine, Calculator, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { FoldRow } from '@/ui/FoldRow'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { Icon } from '@/ui/Icon'
import { InfoTip } from '@/ui/InfoTip'
import { CARD } from '@/ui/card'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { FIELD, PanelCard, PHONE_FOLD } from '@/features/money/expenses/Panel'
import { NumberInput } from '@/ui/form/NumberInput'
import { useAddCashTopup, useCashInHand, useRecordCashCount } from '@/features/money/expenses/hooks'
import { pkr } from '@/features/money/expenses/model'
import type { CashInHand as CashState } from '@/features/money/expenses/claimsApi'

/*
 * Cash in hand (DATA_MODEL A9, owner: yes; 0087). One line, admin only: "Cash in hand: PKR 13,850 expected · counted Mon 19 Oct ·
 * Count cash". Expected = the last count (or the opening balance) + cash drawn from the bank since - cash expenses since. "Count
 * cash" records what is in the box; the database keeps what the books expected then, and the difference shows at once (short or
 * over). "Cash drawn" records cash taken from the bank into the box (not an expense). The first count is the opening balance.
 * Shown on Expenses and on Lock a month. 16 px text, 44 px taps.
 */
export function CashInHandLine({ compact = false, fold = false }: { compact?: boolean; fold?: boolean }) {
  const q = useCashInHand()
  const phone = useMediaQuery('(max-width: 639px)')
  const [open, setOpen] = useState(false)
  const foldId = useId()
  const [counting, setCounting] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const c = q.data
  if (q.isPending) return <div className={cn(CARD, 'grid gap-2 p-card')} aria-hidden="true"><Skeleton className="h-5 w-1/3" /><Skeleton className="h-4 w-1/2" /></div>
  if (q.isError || !c) return null
  const none = c.kind === 'none' || c.expected === null
  // `fold` (the Expenses page) on a phone: ONE line. Not set up: the words and the action. Set up: the figure on the line, the buttons under a tap.
  if (fold && phone) {
    const actions = (
      <>
        {counting ? <CountDialog state={c} onClose={() => setCounting(false)} /> : null}
        {drawing ? <TopupDialog onClose={() => setDrawing(false)} /> : null}
      </>
    )
    if (none)
      return (
        <section aria-label="Cash in hand" data-testid="cash-in-hand" className={cn(CARD, 'flex min-h-touch items-center gap-3 py-1 pl-card pr-2')}>
          <Icon icon={Wallet} className="text-fg-muted" />
          <span className="type-body min-w-0 flex-1">
            <b className="font-semibold">Cash in hand</b> is not set up
          </span>
          <Button size="touch" variant="quiet" onClick={() => setCounting(true)} aria-label="Set up opening cash" className="text-base">
            Set up
          </Button>
          {actions}
        </section>
      )
    const diff = c.kind === 'count' && c.lastDifference !== null && c.lastDifference !== 0 ? ` (${c.lastDifference < 0 ? 'short' : 'over'} ${pkr(Math.abs(c.lastDifference))})` : ''
    return (
      <section aria-label="Cash in hand" data-testid="cash-in-hand">
        <FoldRow
          state={{ icon: Wallet, word: 'Cash' }}
          title="Cash in hand"
          summary={`${pkr(c.expected ?? 0)} expected · ${c.kind === 'opening' ? 'opening' : 'counted'} ${c.baseOn ? formatShortDate(c.baseOn, businessToday()) : ''}${diff}`}
          open={open}
          onToggle={() => setOpen(o => !o)}
          controlsId={foldId}
          className={PHONE_FOLD}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button size="touch" icon={ArrowDownToLine} onClick={() => setDrawing(true)} className="text-base">
              Cash drawn
            </Button>
            <Button size="touch" icon={Calculator} onClick={() => setCounting(true)} className="text-base">
              Count cash
            </Button>
            <InfoTip label="How cash in hand is worked out">
              {`${c.kind === 'opening' ? 'Opening balance' : 'Last count'} ${pkr(c.base)} + cash drawn from the bank since ${pkr(c.topups)} (${c.topupCount}) - cash expenses since ${pkr(c.cashOut)} (${c.cashOutCount}) = ${pkr(c.expected ?? 0)}. Cash drawn from the bank is not an expense.`}
            </InfoTip>
          </div>
        </FoldRow>
        {actions}
      </section>
    )
  }
  const how = (
    <InfoTip label="How cash in hand is worked out">
      {`${c.kind === 'opening' ? 'Opening balance' : 'Last count'} ${pkr(c.base)} + cash drawn from the bank since ${pkr(c.topups)} (${c.topupCount}) - cash expenses since ${pkr(c.cashOut)} (${c.cashOutCount}) = ${pkr(c.expected ?? 0)}. Cash drawn from the bank is not an expense.`}
    </InfoTip>
  )
  const diffWords =
    c.kind === 'count' && c.lastDifference !== null && c.lastDifference !== 0 ? (
      <span className={c.lastDifference < 0 ? 'text-tone-danger-fg' : 'text-tone-warning-fg'}>
        {' '}
        ({c.lastDifference < 0 ? 'short' : 'over'} {pkr(Math.abs(c.lastDifference))})
      </span>
    ) : null
  const buttons = (
    <span className="flex flex-wrap gap-2">
      {!none ? (
        <Button icon={ArrowDownToLine} onClick={() => setDrawing(true)} className="max-md:h-touch">
          Cash drawn
        </Button>
      ) : null}
      <Button icon={Calculator} onClick={() => setCounting(true)} className="max-md:h-touch">
        {none ? 'Set opening cash' : 'Count cash'}
      </Button>
    </span>
  )
  const dialogs = (
    <>
      {counting ? <CountDialog state={c} onClose={() => setCounting(false)} /> : null}
      {drawing ? <TopupDialog onClose={() => setDrawing(false)} /> : null}
    </>
  )
  // `fold` from 640 up (the Expenses page's side column): a side card, the figure in the header, the two buttons under a hairline.
  if (fold)
    return (
      <PanelCard
        headingId="cash-h"
        title="Cash in hand"
        summary={
          none ? (
            'Not set up. Count the office cash once to start. After that the app works out the expected amount.'
          ) : (
            <span aria-live="polite">
              <b className="num font-bold text-fg" data-testid="cash-expected">
                {pkr(c.expected ?? 0)}
              </b>{' '}
              expected · {c.kind === 'opening' ? 'opening' : 'counted'} <span className="num">{c.baseOn ? formatShortDate(c.baseOn, businessToday()) : ''}</span>
              {diffWords}
              {how}
            </span>
          )
        }
        data-testid="cash-in-hand"
      >
        <div className="px-card py-4">{buttons}</div>
        {dialogs}
      </PanelCard>
    )
  return (
    <section aria-label="Cash in hand" data-testid="cash-in-hand" className={cn(CARD, 'flex flex-wrap items-center gap-x-4 gap-y-3 px-card py-4 text-base', compact && 'py-3')}>
      <span aria-hidden="true" className="grid size-control-sm shrink-0 place-items-center rounded-control bg-selected text-fg-2">
        <Icon icon={Wallet} />
      </span>
      {none ? (
        <span className="min-w-0 flex-[1_1_16rem]">
          <b className="font-bold">Cash in hand</b> is not set up. Count the office cash once to start. After that the app works out the expected amount.
        </span>
      ) : (
        <span className="min-w-0 flex-[1_1_16rem]" aria-live="polite">
          <b className="font-bold">Cash in hand:</b>{' '}
          <b className="num font-bold" data-testid="cash-expected">
            {pkr(c.expected ?? 0)}
          </b>{' '}
          expected
          <span className="text-fg-2">
            {' · '}
            {c.kind === 'opening' ? 'opening' : 'counted'} {c.baseOn ? formatShortDate(c.baseOn, businessToday()) : ''}
            {diffWords}
          </span>
          {how}
        </span>
      )}
      {buttons}
      {dialogs}
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
      setError('Enter the cash counted (0 if there is none).')
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
        icon={Calculator}
        title={opening ? 'Set opening cash' : 'Count cash'}
        context={opening ? 'The cash held in the office. From now on the app works out the expected amount.' : `The books expect ${pkr(state.expected ?? 0)}.`}
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
            <span className="text-sm font-bold">Cash in hand, PKR</span>
            <NumberInput value={counted} onChange={setCounted} min={0} inputMode="decimal" autoFocus className="num h-control-lg text-lg max-md:h-control-lg" aria-label="Cash in hand, PKR" />
          </label>
          {opening ? (
            <label className="grid gap-2">
              <span className="text-sm font-bold">At the start of</span>
              <input type="date" value={on} max={today} onChange={e => e.target.value && setOn(e.target.value)} className={cn(FIELD, 'num')} />
            </label>
          ) : null}
          {diff !== null ? (
            <p className={cn('rounded-control px-3 py-2', diff === 0 ? 'bg-tone-success-bg text-tone-success-fg' : 'bg-tone-warning-bg text-tone-warning-fg')} aria-live="polite" data-testid="count-difference">
              {diff === 0 ? 'It matches the books.' : `${diff < 0 ? 'Short' : 'Over'} by ${pkr(Math.abs(diff))}. Check for an unrecorded cash expense. The difference is saved with this count.`}
            </p>
          ) : null}
          <label className="grid gap-2">
            <span className="text-sm font-bold">
              Note <span className="font-regular text-fg-muted">optional</span>
            </span>
            <input value={note} maxLength={200} onChange={e => setNote(e.target.value)} className={FIELD} />
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
        icon={ArrowDownToLine}
        title="Cash drawn from the bank"
        context="Cash taken from the bank into cash in hand. It is not an expense."
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
            <span className="text-sm font-bold">Amount, PKR</span>
            <NumberInput value={amount} onChange={setAmount} min={0.01} inputMode="decimal" autoFocus className="num h-control-lg text-lg max-md:h-control-lg" aria-label="Amount drawn, PKR" />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold">Date</span>
            <input type="date" value={on} max={today} onChange={e => e.target.value && setOn(e.target.value)} className={cn(FIELD, 'num')} />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold">
              Note <span className="font-regular text-fg-muted">optional</span>
            </span>
            <input value={note} maxLength={200} onChange={e => setNote(e.target.value)} className={FIELD} />
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
