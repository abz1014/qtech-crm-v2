import { useId, useState } from 'react'
import { Check, HandCoins } from 'lucide-react'
import { useSession } from '@/app/session'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { FoldRow } from '@/ui/FoldRow'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import { CARD } from '@/ui/card'
import { StatusText } from '@/ui/StatusText'
import { useToast } from '@/ui/useToast'
import { NativeSelect, PanelCard, PHONE_FOLD } from '@/features/money/expenses/Panel'
import { useOwedClaims, usePayBackClaim } from '@/features/money/expenses/hooks'
import { PAID_HOW_LABEL, owedByPerson, type Claim, type PaidHow } from '@/features/money/expenses/claimsApi'
import { pkr } from '@/features/money/expenses/model'

/*
 * "Owed to staff" (0124, process audit 5). A claim the admin approved without paying yet: "Approved, to repay <person>". One line per
 * person with the total, and under it each claim with Mark paid back, which says how it was paid (cash given back, from petty cash, or
 * by bank) and writes the expense on that day. `summary` is the Money home's short form: the people and what each is owed, no buttons.
 * Admin only: for anyone else nothing is drawn and nothing is asked.
 */
export function OwedToStaff({ summary = false }: { summary?: boolean }) {
  const session = useSession()
  const admin = session.status === 'signed-in' && session.user.role === 'admin'
  const q = useOwedClaims(admin)
  const phone = useMediaQuery('(max-width: 639px)')
  const [open, setOpen] = useState(false)
  const id = useId()
  const claims = q.data ?? []
  if (!admin || q.isPending) return null
  if (q.isError)
    return (
      <section aria-label="Claims to repay" data-testid="owed-to-staff" className={cn(CARD, 'p-card')}>
        <EmptyState mood="error" title="Claims to repay could not be loaded" actions={<Button onClick={() => void q.refetch()}>Try again</Button>}>
          Nothing was changed. Check your connection and try again.
        </EmptyState>
      </section>
    )
  if (claims.length === 0) return null
  const people = owedByPerson(claims)
  const total = claims.reduce((s, c) => s + c.amount, 0)
  const who = people.length === 1 ? people[0].name : `${people.length} people`
  const peopleList = (
    <ul className="divide-y" data-testid="owed-people">
      {people.map(p => (
        <li key={p.personId ?? p.name} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-card py-3 text-base">
          <span className="min-w-0 [overflow-wrap:anywhere]">
            To repay <b className="font-bold">{p.name}</b>
            <span className="text-sm text-fg-2"> · {p.count === 1 ? '1 claim' : `${p.count} claims`}</span>
          </span>
          <b className="num font-bold">{pkr(p.total)}</b>
        </li>
      ))}
    </ul>
  )
  const claimList = (
    <ul className="divide-y border-t">
      {claims.map(c => (
        <OwedRow key={c.id} claim={c} />
      ))}
    </ul>
  )
  // Phone, full form: one card row with the figure and who; a tap opens the people and each claim's Mark paid back.
  if (phone && !summary)
    return (
      <section aria-label="Claims to repay" data-testid="owed-to-staff">
        <FoldRow
          // One line on a phone (the chip would squeeze the title and the figure at 320): the state icon in the "now" ink.
          state={{ ...ACTION, className: 'text-tone-warning-fg' }}
          figure
          title="Claims to repay"
          summary={<span className="whitespace-nowrap">{`${pkr(total)} to ${who}`}</span>}
          open={open}
          onToggle={() => setOpen(o => !o)}
          controlsId={id}
          className={cn(PHONE_FOLD, '[&_li]:px-0')}
        >
          {peopleList}
          {claimList}
        </FoldRow>
      </section>
    )
  return (
    <PanelCard
      headingId={summary ? 'owed-staff-sum-h' : 'owed-staff-h'}
      title="Claims to repay"
      summary={
        <>
          <span className="num">{pkr(total)}</span> approved, not paid back yet
        </>
      }
      status={
        <StatusText tone="now" className="text-sm">
          {ACTION.word}
        </StatusText>
      }
      data-testid="owed-to-staff"
    >
      {peopleList}
      {summary ? null : claimList}
    </PanelCard>
  )
}

/** Who acts next on a claim to repay: the admin. */
const ACTION = { icon: HandCoins, word: 'Action needed' }

function OwedRow({ claim }: { claim: Claim }) {
  const toast = useToast()
  const pay = usePayBackClaim()
  const [how, setHow] = useState<PaidHow>('cash_back')
  const [error, setError] = useState<string | null>(null)
  const label = `${claim.byName}, ${pkr(claim.amount)}`
  return (
    <li className="grid gap-3 px-card py-4 text-base" data-testid={`owed-${claim.id}`}>
      <div className="grid gap-1">
        <p className="min-w-0 [overflow-wrap:anywhere]">
          Approved, to repay <b className="font-bold">{claim.byName}</b>: <b className="num font-bold">{pkr(claim.amount)}</b>
          {claim.note ? <span> for {claim.note}</span> : null}
        </p>
        <p className="num flex flex-wrap gap-x-2 text-sm text-fg-2">
          <span>{formatShortDate(claim.spentOn, businessToday())}</span>
          {claim.orderLabel ? <span>· {claim.orderLabel}</span> : null}
        </p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] items-end gap-3">
        <label className="grid min-w-0 gap-2">
          <span className="text-sm font-bold">How it was paid</span>
          <NativeSelect value={how} onChange={e => setHow(e.target.value as PaidHow)} aria-label={`How it was paid back, ${label}`}>
            {(Object.keys(PAID_HOW_LABEL) as PaidHow[]).map(k => (
              <option key={k} value={k}>
                {PAID_HOW_LABEL[k]}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button
          icon={Check}
          busy={pay.isPending}
          busyLabel="Saving"
          aria-label={`Mark paid back: ${label}`}
          className="max-md:h-touch"
          onClick={() =>
            pay.mutate(
              { id: claim.id, paidHow: how },
              {
                onSuccess: () => toast.toast({ title: 'Marked paid back', body: `${label} · ${PAID_HOW_LABEL[how]}`, tone: 'success' }),
                onError: e => setError(mapPgError(e, { entity: 'expense' }).message),
              },
            )
          }
        >
          Mark paid back
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-tone-danger-fg">
          {error}
        </p>
      ) : null}
    </li>
  )
}
