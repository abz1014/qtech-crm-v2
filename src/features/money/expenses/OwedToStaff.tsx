import { useState } from 'react'
import { Check } from 'lucide-react'
import { useSession } from '@/app/session'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { useToast } from '@/ui/useToast'
import { useOwedClaims, usePayBackClaim } from '@/features/money/expenses/hooks'
import { PAID_HOW_LABEL, owedByPerson, type Claim, type PaidHow } from '@/features/money/expenses/claimsApi'
import { pkr } from '@/features/money/expenses/model'

/*
 * "Owed to staff" (0124, process audit 5). A claim the admin approved without paying yet: "Approved, owed to <person>". One line per
 * person with the total, and under it each claim with Mark paid back, which says how it was paid (cash given back, from petty cash, or
 * by bank) and writes the expense on that day. `summary` is the Money home's short form: the people and what each is owed, no buttons.
 * Admin only: for anyone else nothing is drawn and nothing is asked.
 */
export function OwedToStaff({ summary = false }: { summary?: boolean }) {
  const session = useSession()
  const admin = session.status === 'signed-in' && session.user.role === 'admin'
  const q = useOwedClaims(admin)
  const claims = q.data ?? []
  if (!admin || q.isPending || q.isError || claims.length === 0) return null
  const people = owedByPerson(claims)
  const total = claims.reduce((s, c) => s + c.amount, 0)
  return (
    <section aria-labelledby="owed-staff-h" className="grid gap-0 rounded border border-tone-warning-fg/30 bg-surface" data-testid="owed-to-staff">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-3">
        <h2 id="owed-staff-h" className="text-lg font-semibold">
          Owed to staff
        </h2>
        <span className="text-base text-fg-2">
          {pkr(total)} approved, not paid back yet
        </span>
      </header>
      <ul className="divide-y" data-testid="owed-people">
        {people.map(p => (
          <li key={p.personId ?? p.name} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-base">
            <span>
              Owed to <b className="font-semibold">{p.name}</b>
              <span className="text-fg-2"> · {p.count === 1 ? '1 claim' : `${p.count} claims`}</span>
            </span>
            <b className="num font-semibold">{pkr(p.total)}</b>
          </li>
        ))}
      </ul>
      {summary ? null : (
        <ul className="divide-y border-t">
          {claims.map(c => (
            <OwedRow key={c.id} claim={c} />
          ))}
        </ul>
      )}
    </section>
  )
}

function OwedRow({ claim }: { claim: Claim }) {
  const toast = useToast()
  const pay = usePayBackClaim()
  const [how, setHow] = useState<PaidHow>('cash_back')
  const [error, setError] = useState<string | null>(null)
  const label = `${claim.byName}, ${pkr(claim.amount)}`
  return (
    <li className="grid gap-2 px-4 py-3 text-base" data-testid={`owed-${claim.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="min-w-0">
          Approved, owed to <b className="font-semibold">{claim.byName}</b>: <b className="num font-semibold">{pkr(claim.amount)}</b>
          {claim.note ? <span> for {claim.note}</span> : null}
          {claim.orderLabel ? <span className="text-fg-2"> · {claim.orderLabel}</span> : null}
        </span>
        <span className="num text-xs text-fg-muted">{formatShortDate(claim.spentOn, businessToday())}</span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-0 gap-2">
          <span className="font-medium">How it was paid</span>
          <select
            value={how}
            onChange={e => setHow(e.target.value as PaidHow)}
            aria-label={`How it was paid back, ${label}`}
            className="min-h-touch rounded border border-line-input bg-surface px-3 text-base"
          >
            {(Object.keys(PAID_HOW_LABEL) as PaidHow[]).map(k => (
              <option key={k} value={k}>
                {PAID_HOW_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="touch"
          icon={Check}
          busy={pay.isPending}
          busyLabel="Saving"
          aria-label={`Mark paid back: ${label}`}
          className="text-base"
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
