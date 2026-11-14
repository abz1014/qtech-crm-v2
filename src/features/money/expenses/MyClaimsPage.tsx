import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Check, CircleAlert, Trash2, X } from 'lucide-react'
import { useSession } from '@/app/session'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { NoAccessPage } from '@/app/pages/NoAccessPage'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { intakeFiles, type AddedFile } from '@/lib/fileIntake'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { PageHeader } from '@/ui/PageHeader'
import { StatusText } from '@/ui/StatusText'
import { useToast } from '@/ui/useToast'
import { NumberInput } from '@/ui/form/NumberInput'
import { CARD } from '@/ui/card'
import { Skeleton } from '@/ui/Skeleton'
import { useCreateClaim, useMyClaims, useMyVisitOptions, useOrderOptions, useWithdrawClaim } from '@/features/money/expenses/hooks'
import { PAID_HOW_LABEL, type Claim } from '@/features/money/expenses/claimsApi'
import { pkr } from '@/features/money/expenses/model'
import { AMOUNT_ABOVE_ZERO, claimAmountProblem } from '@/features/money/expenses/quick'
import { FIELD, NativeSelect } from '@/features/money/expenses/Panel'
import { cn } from '@/lib/utils'

/*
 * "I paid" (0087, owner decision 2026-10-22: engineers may record what they paid themselves). An engineer types the amount, what it
 * was for, optionally the job, and takes a photo of the receipt. It waits for the admin, who approves it with a category (or not).
 * Until then it counts nowhere. The engineer sees only their own claims and the amounts they typed; no other price anywhere.
 * Phone first: one column, 16 px text, 44 px taps, the camera opens straight away.
 */
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']

export function MyClaimsPage() {
  const session = useSession()
  if (session.status !== 'signed-in' || session.user.role !== 'engineer' && session.user.role !== 'sales') return <NoAccessPage area="I paid" roles={['sales', 'engineer']} adminNote="Admins approve claims on the Expenses page, so there is no I paid page for admins." />
  return <MyClaims />
}

function MyClaims() {
  // The phone bar names the page (its h1 is for screen readers there); without it the bar said "Q-Tech CRM".
  useMobileBar({ title: 'I paid' })
  const today = businessToday()
  const toast = useToast()
  const claims = useMyClaims()
  const orders = useOrderOptions()
  const session = useSession()
  const visits = useMyVisitOptions(session.status === 'signed-in' ? session.user.id : undefined)
  const create = useCreateClaim()
  const withdraw = useWithdrawClaim()
  const [id, setId] = useState(() => crypto.randomUUID())
  const [amount, setAmount] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [spentOn, setSpentOn] = useState(today)
  const [orderId, setOrderId] = useState('')
  const [visitId, setVisitId] = useState('')
  const visitTouched = useRef(false)
  const [photo, setPhoto] = useState<AddedFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  // 0136 "Which visit?": the person's visit today when they have one, else none. Choosing anything themselves is never overridden.
  useEffect(() => {
    if (visitTouched.current || visitId) return
    const todays = (visits.data ?? []).filter(v => v.visitOn === today)
    if (todays.length === 1) {
      setVisitId(todays[0].id)
      setOrderId(todays[0].orderId)
    }
  }, [visits.data, today, visitId])
  const pending = useMemo(() => (claims.data ?? []).filter(c => c.status === 'pending'), [claims.data])

  const submit = () => {
    const amountProblem = claimAmountProblem(amount)
    if (amountProblem || amount === null) {
      setError(amountProblem ?? AMOUNT_ABOVE_ZERO)
      return
    }
    setError(null)
    create.mutate(
      { id, amount, spentOn, note: note.trim() || null, orderId: orderId || null, visitId: visitId || null, photo: photo && !photo.error ? photo.file : null },
      {
        onSuccess: photoOk => {
          toast.toast({
            title: 'Sent for approval',
            body: `${pkr(amount)}${photoOk ? '' : '  · the receipt photo was not uploaded. Add it again'}`,
            tone: photoOk ? 'success' : 'neutral',
          })
          setId(crypto.randomUUID())
          setAmount(null)
          setNote('')
          setOrderId('')
          setVisitId('')
          visitTouched.current = false
          setPhoto(null)
        },
        onError: e => setError(`${mapPgError(e, { entity: 'expense' }).message} Nothing was sent.`),
      },
    )
  }

  const engineer = session.status === 'signed-in' && session.user.role === 'engineer'
  const label = (words: string, optional = false) => (
    <span className="text-sm font-bold">
      {words}
      {optional ? <span className="font-regular text-fg-muted"> optional</span> : null}
    </span>
  )
  const amountField = (
    <label className="grid gap-2">
      {label('How much, PKR')}
      <NumberInput value={amount} onChange={setAmount} min={0.01} inputMode="decimal" className="num h-control-lg text-left text-xl font-bold max-md:h-control-lg max-md:text-xl" aria-label="How much, PKR" />
    </label>
  )
  const noteField = (
    <label className="grid gap-2">
      {label('What for', true)}
      <input value={note} maxLength={200} onChange={e => setNote(e.target.value)} placeholder="e.g. Petrol to the site, cable ties" className={FIELD} />
    </label>
  )
  const dateField = (
    <label className="grid min-w-0 gap-2">
      {label('Date')}
      <input type="date" value={spentOn} max={today} onChange={e => e.target.value && setSpentOn(e.target.value)} className={cn(FIELD, 'num')} />
    </label>
  )
  const jobField = (
    <label className="grid min-w-0 gap-2">
      {label('Job', true)}
      <NativeSelect
        value={orderId}
        onChange={e => {
          visitTouched.current = true
          setOrderId(e.target.value)
          // a visit belongs to one order: another job leaves no visit named
          const v = (visits.data ?? []).find(x => x.id === visitId)
          if (v && v.orderId !== e.target.value) setVisitId('')
        }}
      >
        <option value="">No job</option>
        {(orders.data ?? []).map(o => (
          <option key={o.id} value={o.id}>
            {o.ref} · {o.company}
          </option>
        ))}
      </NativeSelect>
    </label>
  )
  const visitField =
    (visits.data ?? []).length > 0 ? (
      <label className="grid min-w-0 gap-2">
        {label('Which visit?', true)}
        <NativeSelect
          value={visitId}
          onChange={e => {
            visitTouched.current = true
            setVisitId(e.target.value)
            const v = (visits.data ?? []).find(x => x.id === e.target.value)
            if (v) setOrderId(v.orderId)
          }}
        >
          <option value="">No visit</option>
          {(visits.data ?? []).map(v => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </NativeSelect>
      </label>
    ) : null
  const photoButton =
    photo && !photo.error ? (
      <Button icon={X} onClick={() => setPhoto(null)} className="max-md:h-touch">
        Remove receipt photo
      </Button>
    ) : (
      <Button icon={Camera} onClick={() => fileRef.current?.click()} className="max-md:h-touch">
        Photo of the receipt
      </Button>
    )
  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*,application/pdf"
      capture="environment"
      tabIndex={-1}
      aria-hidden="true"
      className="sr-only"
      onChange={async e => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (!f) return
        const [one] = await intakeFiles([f], { accept: PHOTO_TYPES })
        setPhoto(one)
      }}
    />
  )
  const sendButton = (wide: boolean) => (
    <Button type="submit" variant="primary" icon={Check} busy={create.isPending} busyLabel="Sending" className={cn('max-md:h-touch', wide ? 'h-control-lg w-full' : 'ml-auto max-sm:w-full')}>
      Send for approval
    </Button>
  )
  const problem = error ? (
    <p role="alert" className="flex items-start gap-2 rounded-control border border-tone-danger-fg/30 bg-tone-danger-bg px-3 py-2 text-tone-danger-fg">
      <Icon icon={CircleAlert} className="mt-1 shrink-0" />
      {error}
    </p>
  ) : null

  return (
    <div className="mx-auto grid w-full max-w-[45rem] grid-cols-[minmax(0,1fr)] content-start gap-card-gap px-gutter pb-12 pt-4 md:pt-6">
      <PageHeader title="I paid" lede={<span className="text-base">Amounts paid personally for work. Repaid after approval.</span>} />
      <form
        className={cn(CARD, 'grid gap-4 p-card text-base')}
        autoComplete="off"
        onSubmit={e => {
          e.preventDefault()
          submit()
        }}
      >
        {engineer ? (
          // Engineer (63-my-expenses #ipaid-engineer): one column for a phone in one hand, the visit picked for today, the photo and Send
          // each the full width. Only what they typed: no category, no other price.
          <>
            {amountField}
            {noteField}
            {dateField}
            {jobField}
            {visitField}
            <div className="grid gap-3 pt-1 [&>button]:w-full">
              {photoButton}
              {fileInput}
              {sendButton(true)}
            </div>
          </>
        ) : (
          // Sales (63-my-expenses, sales): the date and the job side by side from 640, the photo and Send on one line.
          <>
            {amountField}
            {noteField}
            <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
              {dateField}
              {jobField}
            </div>
            {visitField}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {photoButton}
              {fileInput}
              {sendButton(false)}
            </div>
          </>
        )}
        {problem}
      </form>

      <section aria-labelledby="mine-h" className="grid gap-3">
        <h2 id="mine-h" className="type-section">
          <span>My claims</span>
          {pending.length > 0 ? <span className="text-base font-regular text-fg-2"> · {pending.length} waiting</span> : null}
        </h2>
        {claims.isPending ? (
          <div className={cn(CARD, 'grid gap-3 p-card')} aria-busy="true">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ) : claims.isError ? (
          <div className={cn(CARD, 'p-card')}>
            <EmptyState mood="error" title="Claims could not be loaded" actions={<Button onClick={() => void claims.refetch()}>Try again</Button>}>
              Nothing was changed. Check your connection and try again.
            </EmptyState>
          </div>
        ) : (claims.data ?? []).length === 0 ? (
          <div className={cn(CARD, 'p-card')}>
            <EmptyState title="Nothing yet">Submitted claims and their approval status appear here.</EmptyState>
          </div>
        ) : (
          <ul className={cn(CARD, 'divide-y overflow-clip')}>
            {(claims.data ?? []).map(c => (
              <ClaimLine key={c.id} claim={c} onWithdraw={() => withdraw.mutate(c.id, { onSuccess: () => toast.toast({ title: 'Claim taken back', body: pkr(c.amount), tone: 'neutral' }) })} busy={withdraw.isPending} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function ClaimLine({ claim, onWithdraw, busy }: { claim: Claim; onWithdraw: () => void; busy: boolean }) {
  const state =
    claim.status === 'pending' ? (
      <StatusText tone="waiting" className="text-base">
        Waiting
      </StatusText>
    ) : claim.status === 'owed' ? (
      <StatusText tone="waiting" className="text-base">
        Approved, to be repaid to you
      </StatusText>
    ) : claim.status === 'approved' ? (
      <StatusText tone="done" className="text-base">
        {`Approved${claim.paidHow ? `, ${PAID_HOW_LABEL[claim.paidHow].toLowerCase()}` : ''}`}
      </StatusText>
    ) : (
      <StatusText tone="late" className="text-base">
        Not approved
      </StatusText>
    )
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-card py-4 text-base">
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <b className="num font-bold">{pkr(claim.amount)}</b>
        {claim.note ? <span> · {claim.note}</span> : null}
        {claim.orderLabel ? <span className="text-fg-2"> · {claim.orderLabel}</span> : null}
        {claim.visitLabel ? <span className="text-fg-2"> · {claim.visitLabel}</span> : null}
      </span>
      <span className="justify-self-end">{state}</span>
      <span className="num text-sm text-fg-muted">{formatShortDate(claim.spentOn, businessToday())}</span>
      {claim.status === 'pending' ? (
        <Button variant="quiet" icon={Trash2} onClick={onWithdraw} disabled={busy} aria-label={`Take back ${pkr(claim.amount)}`} className="-mr-2 justify-self-end max-md:h-touch">
          Take back
        </Button>
      ) : claim.status === 'rejected' && claim.rejectReason ? (
        <span className="justify-self-end text-right text-sm text-fg-2 [overflow-wrap:anywhere]">{claim.rejectReason}</span>
      ) : (
        <span />
      )}
    </li>
  )
}
