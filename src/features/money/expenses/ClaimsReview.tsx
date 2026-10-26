import { useMemo, useState } from 'react'
import { Check, ImageIcon, X } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { useToast } from '@/ui/useToast'
import { useApproveClaim, useClaimPhotos, usePendingClaims, useRejectClaim } from '@/features/money/expenses/hooks'
import { PAID_HOW_LABEL, signClaimPhoto, type Claim, type PaidHow } from '@/features/money/expenses/claimsApi'
import { pkr, sortGroups, type Category, type ExpenseGroup } from '@/features/money/expenses/model'
import { pickableCategories } from '@/features/money/expenses/quick'

/*
 * "To approve" (0087, owner: engineers may record "I paid"). The admin's list of engineers' pending claims, on the Expenses screen
 * only while there is one. Each row: who, when, how much, what for, the job and the receipt photo; the admin picks the category and
 * how it was paid back (cash given back, from petty cash, or by bank), then Approve (the expense is written and counts from then
 * on) or Not approved (with a reason the engineer sees). A pending claim is in no total anywhere.
 */
export function ClaimsReview({ categories, groups }: { categories: readonly Category[]; groups: readonly ExpenseGroup[] }) {
  const q = usePendingClaims()
  const claims = q.data ?? []
  if (q.isPending || q.isError || claims.length === 0) return null
  return (
    <section aria-labelledby="claims-h" className="grid gap-0 rounded border border-tone-info-fg/30 bg-surface" data-testid="claims-review">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-3">
        <h2 id="claims-h" className="text-lg font-semibold">
          To approve
        </h2>
        <span className="text-base text-fg-2">
          {claims.length === 1 ? '1 claim' : `${claims.length} claims`} from engineers · {pkr(claims.reduce((s, c) => s + c.amount, 0))} · not counted until approved
        </span>
      </header>
      <ul className="divide-y">
        {claims.map(c => (
          <ClaimRow key={c.id} claim={c} categories={categories} groups={groups} />
        ))}
      </ul>
    </section>
  )
}

function ClaimRow({ claim, categories, groups }: { claim: Claim; categories: readonly Category[]; groups: readonly ExpenseGroup[] }) {
  const toast = useToast()
  const approve = useApproveClaim()
  const reject = useRejectClaim()
  const photos = useClaimPhotos(claim.id)
  const [categoryId, setCategoryId] = useState('ca7e0000-0000-4000-8000-000000000004')
  const [paidHow, setPaidHow] = useState<PaidHow>('cash_back')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const grouped = useMemo(() => {
    const ok = pickableCategories(categories)
    return sortGroups(groups)
      .map(g => ({ g, items: ok.filter(c => c.groupId === g.id).sort((a, b) => a.sort - b.sort) }))
      .filter(x => x.items.length > 0)
  }, [categories, groups])
  const busy = approve.isPending || reject.isPending
  const label = `${claim.byName}, ${pkr(claim.amount)}`

  const openPhoto = async (path: string) => {
    try {
      window.open(await signClaimPhoto(path), '_blank', 'noopener')
    } catch {
      toast.toast({ title: "Couldn't open the photo", body: 'Try again in a moment.', tone: 'danger' })
    }
  }

  return (
    <li className="grid gap-3 px-4 py-4 text-base" data-testid={`claim-${claim.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="min-w-0">
          <b className="font-semibold">{claim.byName}</b> paid <b className="num font-semibold">{pkr(claim.amount)}</b>
          {claim.note ? <span> for {claim.note}</span> : null}
          {claim.orderLabel ? <span className="text-fg-2"> · {claim.orderLabel}</span> : null}
        </span>
        <span className="num text-xs text-fg-muted">{formatShortDate(claim.spentOn, businessToday())}</span>
      </div>
      {(photos.data ?? []).length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {(photos.data ?? []).map((p, i) => (
            <Button key={p.path} size="touch" icon={ImageIcon} onClick={() => void openPhoto(p.path)} className="text-base">
              {`Receipt${(photos.data ?? []).length > 1 ? ` ${i + 1}` : ''}`}
            </Button>
          ))}
        </div>
      ) : photos.isSuccess ? (
        <span className="text-fg-2">No receipt photo.</span>
      ) : null}
      {rejecting ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-0 flex-1 gap-2">
            <span className="font-medium">Why not? The engineer sees this.</span>
            <input value={reason} maxLength={200} onChange={e => setReason(e.target.value)} placeholder="e.g. No receipt" className="min-h-touch rounded border border-line-input bg-surface px-3 text-base" />
          </label>
          <Button size="touch" variant="quiet" onClick={() => setRejecting(false)} disabled={busy} className="text-base">
            Back
          </Button>
          <Button
            size="touch"
            variant="danger"
            icon={X}
            busy={reject.isPending}
            busyLabel="Saving"
            aria-label={`Not approved: ${label}`}
            onClick={() =>
              reject.mutate(
                { id: claim.id, reason: reason.trim() || null },
                {
                  onSuccess: () => toast.toast({ title: 'Claim not approved', body: label, tone: 'neutral' }),
                  onError: e => setError(mapPgError(e, { entity: 'expense' }).message),
                },
              )
            }
            className="text-base"
          >
            Not approved
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-0 gap-2">
            <span className="font-medium">Category</span>
            <select
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
              aria-label={`Category for ${label}`}
              className="min-h-touch max-w-full rounded border border-line-input bg-surface px-3 text-base"
            >
              {grouped.map(x => (
                <optgroup key={x.g.id} label={x.g.name}>
                  {x.items.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-2">
            <span className="font-medium">Paid back</span>
            <select
              value={paidHow}
              onChange={e => setPaidHow(e.target.value as PaidHow)}
              aria-label={`Paid back, ${label}`}
              className="min-h-touch rounded border border-line-input bg-surface px-3 text-base"
            >
              {(Object.keys(PAID_HOW_LABEL) as PaidHow[]).map(k => (
                <option key={k} value={k}>
                  {PAID_HOW_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <span className="flex flex-wrap gap-2">
            <Button size="touch" variant="quiet" onClick={() => setRejecting(true)} disabled={busy} aria-label={`Not approved…, ${label}`} className="text-base">
              Not approved…
            </Button>
            <Button
              size="touch"
              icon={Check}
              busy={approve.isPending}
              busyLabel="Approving"
              aria-label={`Approve ${label}`}
              onClick={() =>
                approve.mutate(
                  { id: claim.id, categoryId, paidHow },
                  {
                    onSuccess: () =>
                      toast.toast({ title: 'Approved', body: `${label} · ${categories.find(c => c.id === categoryId)?.name ?? ''} · ${PAID_HOW_LABEL[paidHow]}`, tone: 'success' }),
                    onError: e => setError(mapPgError(e, { entity: 'expense' }).message),
                  },
                )
              }
              className="text-base"
            >
              Approve
            </Button>
          </span>
        </div>
      )}
      {error ? (
        <p role="alert" className="flex items-center gap-2 text-tone-danger-fg">
          <Icon icon={X} />
          {error}
        </p>
      ) : null}
    </li>
  )
}
