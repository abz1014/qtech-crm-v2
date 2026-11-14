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
import { cn } from '@/lib/utils'
import { CARD } from '@/ui/card'
import { StatusText } from '@/ui/StatusText'
import { useToast } from '@/ui/useToast'
import { FIELD, NativeSelect, PanelCard, PHONE_FOLD } from '@/features/money/expenses/Panel'
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
      <section aria-label="To approve" data-testid="claims-review" className={cn(CARD, 'p-card')}>
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
  // Phone: one card row with the count and the figure; a tap opens the claims. The figures are on the line, never behind the tap.
  if (phone)
    return (
      <section aria-label="To approve" data-testid="claims-review">
        <FoldRow
          state={ACTION}
          chip={{ ...ACTION, tone: 'warning' }}
          title="To approve"
          summary={`${count} · ${total}`}
          open={open}
          onToggle={() => setOpen(o => !o)}
          controlsId={id}
          className={cn(PHONE_FOLD, '[&_li]:px-0')}
        >
          {list}
        </FoldRow>
      </section>
    )
  return (
    <PanelCard
      headingId="claims-h"
      title="To approve"
      summary={
        <>
          {count} from staff · <span className="num">{total}</span> · not counted until approved
        </>
      }
      status={
        <StatusText tone="now" className="text-sm">
          {ACTION.word}
        </StatusText>
      }
      data-testid="claims-review"
    >
      {list}
    </PanelCard>
  )
}

/** Who acts next on a claim: the admin (the Forest "now" tone, the state word the fold row reads). */
const ACTION = { icon: HandCoins, word: 'Action needed' }

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
    <li className="grid gap-4 px-card py-5 text-base" data-testid={`claim-${claim.id}`}>
      <div className="grid gap-1">
        <p className="min-w-0 [overflow-wrap:anywhere]">
          <b className="font-bold">{claim.byName}</b> paid <b className="num font-bold">{pkr(claim.amount)}</b>
          {claim.note ? <span> for {claim.note}</span> : null}
        </p>
        <p className="num flex flex-wrap gap-x-2 text-sm text-fg-2">
          <span>{formatShortDate(claim.spentOn, businessToday())}</span>
          {claim.orderLabel ? <span>· {claim.orderLabel}</span> : null}
          {claim.rfqLabel && !claim.orderLabel ? <span>· {claim.rfqLabel}</span> : null}
          {claim.visitLabel ? <span className="font-sans">· {claim.visitLabel}</span> : null}
        </p>
      </div>
      {(photos.data ?? []).length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {(photos.data ?? []).map((p, i) => (
            <Button key={p.path} icon={ImageIcon} onClick={() => void openPhoto(p.path)} className="max-md:h-touch">
              {`Receipt${(photos.data ?? []).length > 1 ? ` ${i + 1}` : ''}`}
            </Button>
          ))}
        </div>
      ) : photos.isSuccess ? (
        <span className="text-sm text-fg-muted">No receipt photo.</span>
      ) : null}
      {rejecting ? (
        <div className="grid gap-3">
          <label className="grid min-w-0 gap-2">
            <span className="text-sm font-bold">Why not? The engineer sees this.</span>
            <input value={reason} maxLength={200} onChange={e => setReason(e.target.value)} placeholder="e.g. No receipt" className={FIELD} />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="quiet" onClick={() => setRejecting(false)} disabled={busy} className="max-md:h-touch">
              Back
            </Button>
            <Button
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
              className="max-md:h-touch"
            >
              Not approved
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {/* Category and Paid back side by side where the card has room (the claims page width), stacked in the side column. */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] items-end gap-3">
            <label className="grid min-w-0 gap-2">
              <span className="flex items-center justify-between gap-2 text-sm font-bold">
                Category
                {others.length > 0 && !isOther ? (
                  <button
                    type="button"
                    onClick={() => setCategoryId(others[0].id)}
                    aria-label={`File under Other: ${label}`}
                    className="-my-2 inline-flex min-h-touch items-center rounded-control px-2 font-bold text-primary hover:bg-selected md:min-h-control-sm"
                  >
                    Other
                  </button>
                ) : null}
              </span>
              <NativeSelect value={categoryId} onChange={e => setCategoryId(e.target.value)} aria-label={`Category for ${label}`}>
                {grouped.map(x => (
                  <optgroup key={x.g.id} label={x.g.name}>
                    {x.items.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </NativeSelect>
            </label>
            <label className="grid min-w-0 gap-2">
              <span className="text-sm font-bold">Paid back</span>
              <NativeSelect value={paidHow} onChange={e => setPaidHow(e.target.value as PaidHow)} aria-label={`Paid back, ${label}`}>
                {(Object.keys(PAID_HOW_LABEL) as PaidHow[]).map(k => (
                  <option key={k} value={k}>
                    {PAID_HOW_LABEL[k]}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </div>
          {isOther ? (
            <p className="text-sm text-fg-2" data-testid="claim-other-title">
              It is an Other, so it shows in the reports as <b className="font-bold text-fg">{title || 'no title'}</b>.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="quiet" onClick={() => setRejecting(true)} disabled={busy} aria-label={`Not approved…, ${label}`} className="mr-auto max-md:h-touch">
              Not approved…
            </Button>
            <Button
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
              className="max-md:h-touch"
            >
              Approve, pay later
            </Button>
            <Button
              variant="primary"
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
              className="max-md:h-touch"
            >
              Approve
            </Button>
          </div>
        </div>
      )}
      {error ? (
        <p role="alert" className="flex items-start gap-2 text-tone-danger-fg">
          <Icon icon={X} className="mt-1 shrink-0" />
          {error}
        </p>
      ) : null}
    </li>
  )
}
