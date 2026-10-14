import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useBrands, useCarryBrand, useCompanyBrands, useUnlinkBrand } from '@/features/companies/hooks'
import { removeErrorMessage } from '@/features/companies/removeError'
import { ConfirmRemove, Fine, Panel } from '@/features/companies/CompanyParts'
import { mapPgError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Combobox, type ComboOption } from '@/ui/form/Combobox'
import { Skeleton } from '@/ui/Skeleton'
import { Tag } from '@/ui/Tag'
import { useToast } from '@/ui/useToast'

/*
 * Brands carried: the brands and product families this company supplies. Pick an existing one or type a
 * new name; either way it is one action. Quoting a brand's item also adds it here by itself (the
 * supplier_quote_lines trigger), so this list mostly fills as a by-product of work.
 */
export function BrandsPanel({ companyId }: { companyId: string }) {
  const carried = useCompanyBrands(companyId)
  const [adding, setAdding] = useState(false)
  const all = useBrands(adding)
  const carry = useCarryBrand(companyId)
  const unlink = useUnlinkBrand(companyId)
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const { toast } = useToast()

  const options = useMemo<ComboOption[]>(() => {
    const have = new Set((carried.data ?? []).map(b => b.brandId))
    return (all.data ?? []).filter(b => !have.has(b.id)).map(b => ({ value: b.id, label: b.name, meta: b.kind === 'family' ? 'Product family' : undefined }))
  }, [all.data, carried.data])

  const done = (name: string) => {
    setAdding(false)
    toast({ title: `Added ${name}`, tone: 'success' })
  }
  const cancelRemove = () => {
    const id = removing?.id
    setRemoving(null)
    setRemoveError(null)
    if (id) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-remove-brand="${id}"]`)?.focus())
  }
  const confirmRemove = () => {
    if (!removing) return
    unlink.mutate(removing.id, {
      onSuccess: () => {
        toast({ title: `Removed ${removing.name}`, tone: 'success' })
        setRemoving(null)
      },
      onError: err => setRemoveError(removeErrorMessage(err, 'brand')),
    })
  }
  const fail = (err: unknown) => toast({ title: "Couldn't add the brand", body: mapPgError(err, { entity: 'brand' }).message, tone: 'danger' })

  return (
    <Panel
      title="Brands carried"
      actions={
        adding ? null : (
          <Button variant="quiet" size="sm" icon={Plus} onClick={() => setAdding(true)}>
            Add
          </Button>
        )
      }
    >
      <div className="grid gap-3 px-5 py-4">
        {carried.isPending ? (
          <Skeleton className="h-5 w-2/3" />
        ) : carried.isError ? (
          <Banner tone="danger" title="Couldn't load the brands">
            Reload the page to try again.
          </Banner>
        ) : carried.data.length === 0 && !adding ? (
          <Fine>No brands yet. Add one here, or quote an item from this supplier and its brand is added for you.</Fine>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {carried.data.map(b => (
              <li key={b.brandId} className="flex items-center gap-1">
                <Tag>{b.name}</Tag>
                {b.kind === 'family' ? <span className="sr-only"> (product family)</span> : null}
                <Button
                  variant="quiet"
                  size="sm"
                  icon={X}
                  aria-label={`Remove ${b.name}`}
                  data-remove-brand={b.brandId}
                  onClick={() => {
                    setRemoveError(null)
                    setRemoving({ id: b.brandId, name: b.name })
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        {removing ? (
          <ConfirmRemove
            title={`Remove ${removing.name}?`}
            detail="It stops being listed for this supplier. The brand itself and any quotes for it stay."
            busy={unlink.isPending}
            error={removeError}
            onConfirm={confirmRemove}
            onCancel={cancelRemove}
          />
        ) : null}
        {adding ? (
          <div className="grid gap-2">
            <Combobox
              aria-label="Brand or product family"
              options={options}
              value={null}
              loading={all.isPending}
              placeholder="Type a brand, for example Belimo"
              autoComplete="off"
              onChange={id => {
                const picked = options.find(o => o.value === id)
                if (id && picked) carry.mutate({ brandId: id }, { onSuccess: () => done(picked.label), onError: fail })
              }}
              onCreate={text => carry.mutate({ newName: text.trim(), id: crypto.randomUUID() }, { onSuccess: () => done(text.trim()), onError: fail })}
              createLabel={t => `Add “${t}” as a new brand`}
            />
            <div>
              <Button variant="quiet" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  )
}
