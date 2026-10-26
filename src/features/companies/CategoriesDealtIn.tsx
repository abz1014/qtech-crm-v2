import { useMemo } from 'react'
import { Tag as TagIcon, TagsIcon } from 'lucide-react'
import { useSession } from '@/app/session'
import { mapPgError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Select } from '@/ui/form/Select'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { Fine, Panel } from '@/features/companies/CompanyParts'
import { dealtRows } from '@/features/companies/dealtInModel'
import { useCarryBrand, useCompanyBrands, useSupplierCategoryEvidence, useUnlinkBrand } from '@/features/companies/hooks'
import { useCuratedCategories } from '@/features/rfqs/hooks'

/*
 * Categories they deal in (C4): on a supplier's page, each product category they have quoted, been ordered from or been asked
 * about, with the counts behind it ("quoted 6 · ordered 2"), and the tag that puts them in "Deals in <category>" on the ask list
 * (supplierSuggestion.ts). Admin and sales tag and untag; an engineer reads the counts. A quote also tags a supplier by itself
 * (learn_company_brands), so most tags arrive as a by-product of work. Counts only; never a rating.
 */
export function CategoriesDealtIn({ companyId }: { companyId: string }) {
  const session = useSession()
  const canTag = session.status === 'signed-in' && (session.user.role === 'admin' || session.user.role === 'sales')
  const evidence = useSupplierCategoryEvidence(companyId)
  const carried = useCompanyBrands(companyId)
  const curated = useCuratedCategories(canTag)
  const carry = useCarryBrand(companyId)
  const unlink = useUnlinkBrand(companyId)
  const { toast } = useToast()
  const rows = useMemo(() => dealtRows(evidence.data ?? [], carried.data ?? []), [evidence.data, carried.data])
  const loading = evidence.isPending || carried.isPending
  const failed = evidence.isError || carried.isError
  const shown = new Set(rows.map(r => r.familyId))
  const options = (curated.data ?? []).filter(c => !shown.has(c.id)).map(c => ({ value: c.id, label: c.name }))
  const fail = (title: string) => (err: unknown) => toast({ title, body: mapPgError(err, { entity: 'category' }).message, tone: 'danger' })
  const busy = carry.isPending || unlink.isPending

  return (
    <Panel title="Categories they deal in" meta={loading || failed ? undefined : rows.length === 0 ? 'None yet' : `${rows.length}`}>
      <div className="grid gap-3 p-4">
        {loading ? (
          <Skeleton className="h-10 w-full" />
        ) : failed ? (
          <Banner tone="danger" title="Could not load the categories">
            Reload the page to try again.
          </Banner>
        ) : rows.length === 0 ? (
          <Fine>None yet. A category is added by itself when they quote an item in it, or you can tag one below.</Fine>
        ) : (
          <ul className="grid gap-1" aria-label="Categories they deal in">
            {rows.map(r => (
              <li key={r.familyId} className="flex min-h-touch flex-wrap items-center gap-x-3 gap-y-1 border-b py-1 last:border-b-0" data-tagged={r.tagged || undefined}>
                <span className="min-w-[8rem] flex-1">
                  <span className="block text-base font-medium">{r.name}</span>
                  <span className="block text-base text-fg-muted">{r.evidence}</span>
                </span>
                {r.tagged ? <span className="inline-flex min-h-chip items-center gap-1 text-base text-fg-2"><TagIcon aria-hidden="true" className="size-4" />Tagged</span> : null}
                {canTag ? (
                  r.tagged ? (
                    <Button size="sm" disabled={busy} aria-label={`Untag ${r.name}`} onClick={() => unlink.mutate(r.familyId, { onSuccess: () => toast({ title: `Untagged ${r.name}`, tone: 'success' }), onError: fail("Couldn't untag") })}>
                      Untag
                    </Button>
                  ) : (
                    <Button size="sm" disabled={busy} aria-label={`Tag ${r.name}`} onClick={() => carry.mutate({ brandId: r.familyId }, { onSuccess: () => toast({ title: `Tagged ${r.name}`, tone: 'success' }), onError: fail("Couldn't tag") })}>
                      Tag
                    </Button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canTag && !loading && !failed && options.length > 0 ? (
          <div className="grid max-w-[360px] gap-1">
            <label htmlFor="tag-category" className="flex items-center gap-2 text-base font-medium">
              <TagsIcon aria-hidden="true" className="size-4" />
              Tag a category
            </label>
            <Select
              id="tag-category"
              value=""
              placeholder="Choose a category"
              disabled={busy}
              onChange={e => {
                const id = e.target.value
                const name = options.find(o => o.value === id)?.label ?? 'the category'
                if (id) carry.mutate({ brandId: id }, { onSuccess: () => toast({ title: `Tagged ${name}`, tone: 'success' }), onError: fail("Couldn't tag") })
              }}
              options={options}
            />
          </div>
        ) : null}
      </div>
    </Panel>
  )
}
