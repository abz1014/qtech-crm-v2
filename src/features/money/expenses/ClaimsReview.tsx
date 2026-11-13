import { useId, useMemo, useState } from 'react'
import { Check, HandCoins, ImageIcon, X } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { FoldRow } from '@/ui/FoldRow'
import { Icon } from '@/ui/Icon'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { useToast } from '@/ui/useToast'
import { useApproveClaim, useClaimPhotos, useOweClaim, usePendingClaims, useRejectClaim } from '@/features/money/expenses/hooks'
import { PAID_HOW_LABEL, signClaimPhoto, type Claim, type PaidHow } from '@/features/money/expenses/claimsApi'
import { miscCategories, pkr, sortGroups, type Category, type ExpenseGroup } from '@/features/money/expenses/model'
import { pickableCategories } from '@/features/money/expenses/quick'

/*
 * "To approve" (0087, owner: engineers may record "I paid"). The admin's list of engineers' pending claims, on the Expenses screen
 * only while there is one. Each row: who, when, how much, what for, the job and the receipt photo; the admin picks the category and
 * how it was paid back (cash given back, from petty cash, or by bank), then Approve (the expense is written and counts from then
 * on) or Not approved (with a reason the engineer sees). A pending claim is in no total anywhere.
 */
export function ClaimsReview({ categories, groups }: { categories: readonly Category[]; groups: readonly ExpenseGroup[] }) {
  const q = usePendingClaims()
  const phone = useMediaQuery('(max-width: 639px)')
  const [open, setOpen] = useState(false)
  const id = useId()
  const claims = q.data ?? []
  if (q.isPending) return null
  if (q.isError)
    return (
      <section aria-label="To approve" data-testid="claims-review">
        <EmptyState mood="error" title="Claims to approve could not be loaded" actions={<Button onClick={() => void q.refetch()}>Try again</Button>}>
          Nothing was changed. Check your connection and try again.
        </EmptyState>
      </section>
    )
  if (claims.length === 0) return null
  const count = claims.length === 1 ? '1 claim' : `${claims.length} claims`
  const total = pkr(claims.reduce((s, c) => s + c.amount, 0))
  const list = (
    <ul className="divide-y">
      {claims.map(c => (
        <ClaimRow key={c.id} claim={c} categories={categories} groups={groups} />
      ))}
    </ul>
  )
  // Phone: one line with the count and the figure; a tap opens the claims. The figures are on the line, never behind the tap.
  if (phone)
    return (
      <section aria-label="To approve" data-testid="claims-review">
        <FoldRow state={{ icon: HandCoins, word: 'Action needed' }} title="To approve" summary={`${count} · ${total}`} open={open} onToggle={() => setOpen(o => !o)} controlsId={id}>
          {list}
        </FoldRow>
      </section>
    )
  return (
    <section aria-labelledby="claims-h" className="grid gap-0 rounded border border-tone-info-fg/30 bg-surface lg:rounded-none lg:border-x-0 lg:border-t-0 lg:bg-transparent" data-testid="claims-review">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-3 lg:px-0 lg:py-2">
        <h2 id="claims-h" className="type-row lg:font-semibold">
          To approve
        </h2>
        <span className="text-base text-fg-2">
          {count} from staff · {total} · not counted until approved
        </span>
      </header>
      {list}
    </section>
  )
}

function ClaimRow({ claim, categories, groups }: { claim: Claim; categories: readonly Category[]; groups: readonly ExpenseGroup[] }) {
  const toast = useToast()
  const approve = useApproveClaim()
  const owe = useOweClaim()
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
  const busy = approve.isPending || reject.isPending || owe.isPending
  const others = useMemo(() => miscCategories(categories, groups), [categories, groups])
  const isOther = !!categories.find(c => c.id === categoryId)?.isMisc
  const title = [claim.note?.trim(), claim.byName].filter(Boolean).join(' · ')
  const label = `${claim.byName}, ${pkr(claim.amount)}`

  const openPhoto = async (path: string) => {
    try {
      window.open(await signClaimPhoto(path), '_blank', 'noopener')
    } catch {
      toast.toast({ title: "The photo could not be opened", body: 'Try again in a moment.', tone: 'danger' })
    }
  }

  return (
    <li className="grid gap-3 px-4 py-4 text-base lg:px-0 lg:py-3" data-testid={`claim-${claim.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="min-w-0">
          <b className="font-semibold">{claim.byName}</b> paid <b className="num font-semibold">{pkr(claim.amount)}</b>
          {claim.note ? <span> for {claim.note}</span> : null}
          {claim.orderLabel ? <span className="text-fg-2"> · {claim.orderLabel}</span> : null}
          {claim.rfqLabel && !claim.orderLabel ? <span className="text-fg-2"> · {claim.rfqLabel}</span> : null}
          {claim.visitLabel ? <span className="text-fg-2"> · {claim.visitLabel}</span> : null}
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
          {others.length > 0 && !isOther ? (
            <Button size="touch" variant="quiet" onClick={() => setCategoryId(others[0].id)} className="text-base" aria-label={`File under Other: ${label}`}>
              Other
            </Button>
          ) : null}
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
              variant="quiet"
              busy={owe.isPending}
              busyLabel="Saving"
              disabled={busy}
              aria-label={`Approve, pay later: ${label}`}
              onClick={() =>
                owe.mutate(
                  { id: claim.id, categoryId },
                  {
                    onSuccess: () => toast.toast({ title: `Approved, to repay ${claim.byName}`, body: `${label} · ${categories.find(c => c.id === categoryId)?.name ?? ''} · mark it paid back when repaid`, tone: 'success' }),
                    onError: e => setError(mapPgError(e, { entity: 'expense' }).message),
                  },
                )
              }
              className="text-base"
            >
              Approve, pay later
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
      {isOther && !rejecting ? (
        <p className="text-base text-fg-2" data-testid="claim-other-title">
          It is an Other, so it shows in the reports as <b className="font-medium text-fg">{title || 'no title'}</b>.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="flex items-center gap-2 text-tone-danger-fg">
          <Icon icon={X} />
          {error}
        </p>
      ) : null}
    </li>
  )
}
