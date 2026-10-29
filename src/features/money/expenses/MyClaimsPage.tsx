import { useMemo, useRef, useState } from 'react'
import { Camera, Check, CircleAlert, Trash2, X } from 'lucide-react'
import { useSession } from '@/app/session'
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
import { useCreateClaim, useMyClaims, useOrderOptions, useWithdrawClaim } from '@/features/money/expenses/hooks'
import { PAID_HOW_LABEL, type Claim } from '@/features/money/expenses/claimsApi'
import { pkr } from '@/features/money/expenses/model'
import { AMOUNT_ABOVE_ZERO, claimAmountProblem } from '@/features/money/expenses/quick'

/*
 * "I paid" (0087, owner decision 2026-10-22: engineers may record what they paid themselves). An engineer types the amount, what it
 * was for, optionally the job, and takes a photo of the receipt. It waits for the admin, who approves it with a category (or not).
 * Until then it counts nowhere. The engineer sees only their own claims and the amounts they typed; no other price anywhere.
 * Phone first: one column, 16 px text, 44 px taps, the camera opens straight away.
 */
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']

export function MyClaimsPage() {
  const session = useSession()
  if (session.status !== 'signed-in' || session.user.role !== 'engineer') return <NoAccessPage area="I paid" />
  return <MyClaims />
}

function MyClaims() {
  const today = businessToday()
  const toast = useToast()
  const claims = useMyClaims()
  const orders = useOrderOptions()
  const create = useCreateClaim()
  const withdraw = useWithdrawClaim()
  const [id, setId] = useState(() => crypto.randomUUID())
  const [amount, setAmount] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [spentOn, setSpentOn] = useState(today)
  const [orderId, setOrderId] = useState('')
  const [photo, setPhoto] = useState<AddedFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const pending = useMemo(() => (claims.data ?? []).filter(c => c.status === 'pending'), [claims.data])

  const submit = () => {
    const amountProblem = claimAmountProblem(amount)
    if (amountProblem || amount === null) {
      setError(amountProblem ?? AMOUNT_ABOVE_ZERO)
      return
    }
    setError(null)
    create.mutate(
      { id, amount, spentOn, note: note.trim() || null, orderId: orderId || null, photo: photo && !photo.error ? photo.file : null },
      {
        onSuccess: photoOk => {
          toast.toast({
            title: 'Sent for approval',
            body: `${pkr(amount)}${photoOk ? '' : ' · the receipt photo did not upload; add it again'}`,
            tone: photoOk ? 'success' : 'neutral',
          })
          setId(crypto.randomUUID())
          setAmount(null)
          setNote('')
          setOrderId('')
          setPhoto(null)
        },
        onError: e => setError(`${mapPgError(e, { entity: 'expense' }).message} Nothing was sent.`),
      },
    )
  }

  return (
    <div className="mx-auto grid w-full max-w-[720px] grid-cols-[minmax(0,1fr)] content-start gap-4 px-4 pb-12 pt-4 md:px-8 md:pt-6">
      <PageHeader title="I paid" lede={<span className="text-base">Money you paid yourself for work. The office pays you back once it is approved.</span>} />
      <form
        className="grid gap-4 rounded-panel border bg-surface p-4 text-base"
        autoComplete="off"
        onSubmit={e => {
          e.preventDefault()
          submit()
        }}
      >
        <label className="grid gap-2">
          <span className="font-medium">How much, PKR</span>
          <NumberInput value={amount} onChange={setAmount} min={0.01} inputMode="decimal" className="num h-12 text-xl" aria-label="How much, PKR" />
        </label>
        <label className="grid gap-2">
          <span className="font-medium">
            What for <span className="font-regular text-fg-muted">optional</span>
          </span>
          <input value={note} maxLength={200} onChange={e => setNote(e.target.value)} placeholder="e.g. Petrol to the site, cable ties" className="min-h-touch rounded border border-line-input bg-surface px-3 text-base placeholder:text-fg-muted" />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2">
            <span className="font-medium">Date</span>
            <input type="date" value={spentOn} max={today} onChange={e => e.target.value && setSpentOn(e.target.value)} className="num min-h-touch rounded border border-line-input bg-surface px-3 text-base" />
          </label>
          <label className="grid min-w-0 gap-2">
            <span className="font-medium">
              Job <span className="font-regular text-fg-muted">optional</span>
            </span>
            <select value={orderId} onChange={e => setOrderId(e.target.value)} className="min-h-touch w-full min-w-0 rounded border border-line-input bg-surface px-3 text-base">
              <option value="">No job</option>
              {(orders.data ?? []).map(o => (
                <option key={o.id} value={o.id}>
                  {o.ref} · {o.company}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {photo && !photo.error ? (
            <Button size="touch" icon={X} onClick={() => setPhoto(null)} className="text-base">
              Remove receipt photo
            </Button>
          ) : (
            <Button size="touch" icon={Camera} onClick={() => fileRef.current?.click()} className="text-base">
              Photo of the receipt
            </Button>
          )}
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
          <Button type="submit" variant="primary" size="touch" icon={Check} busy={create.isPending} busyLabel="Sending" className="ml-auto text-base max-sm:w-full">
            Send for approval
          </Button>
        </div>
        {error ? (
          <p role="alert" className="flex items-center gap-2 text-tone-danger-fg">
            <Icon icon={CircleAlert} />
            {error}
          </p>
        ) : null}
      </form>

      <section aria-labelledby="mine-h" className="grid gap-2">
        <h2 id="mine-h" className="text-lg font-semibold">
          <span>My claims</span>
          {pending.length > 0 ? <span className="font-regular text-fg-2"> · {pending.length} waiting</span> : null}
        </h2>
        {claims.isPending ? (
          <div className="h-16 animate-pulse rounded-row border bg-sunken" aria-busy="true" />
        ) : (claims.data ?? []).length === 0 ? (
          <EmptyState title="Nothing yet">What you send shows here, with whether it was approved.</EmptyState>
        ) : (
          <ul className="divide-y rounded-panel border bg-surface">
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
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-base">
      <span className="min-w-0">
        <b className="num font-semibold">{pkr(claim.amount)}</b>
        {claim.note ? <span> · {claim.note}</span> : null}
        {claim.orderLabel ? <span className="text-fg-2"> · {claim.orderLabel}</span> : null}
      </span>
      <span className="justify-self-end">{state}</span>
      <span className="num text-xs text-fg-muted">{formatShortDate(claim.spentOn, businessToday())}</span>
      {claim.status === 'pending' ? (
        <Button size="touch" variant="quiet" icon={Trash2} onClick={onWithdraw} disabled={busy} aria-label={`Take back ${pkr(claim.amount)}`} className="justify-self-end text-base">
          Take back
        </Button>
      ) : claim.status === 'rejected' && claim.rejectReason ? (
        <span className="justify-self-end text-fg-2">{claim.rejectReason}</span>
      ) : (
        <span />
      )}
    </li>
  )
}
