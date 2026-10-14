import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useBrands, useCarryBrand, useCompanyBrands } from '@/features/companies/hooks'
import { Fine, Panel } from '@/features/companies/CompanyParts'
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
  const { toast } = useToast()

  const options = useMemo<ComboOption[]>(() => {
    const have = new Set((carried.data ?? []).map(b => b.brandId))
    return (all.data ?? []).filter(b => !have.has(b.id)).map(b => ({ value: b.id, label: b.name, meta: b.kind === 'family' ? 'Product family' : undefined }))
  }, [all.data, carried.data])

  const done = (name: string) => {
    setAdding(false)
    toast({ title: `Added ${name}`, tone: 'success' })
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
              <li key={b.brandId}>
                <Tag>{b.name}</Tag>
                {b.kind === 'family' ? <span className="sr-only"> (product family)</span> : null}
              </li>
            ))}
          </ul>
        )}
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
