import { Suspense, useId, useState } from 'react'
import { lazyWithReload } from '@/lib/importWithReload'
import { Combobox } from '@/ui/form/Combobox'
import { useCompanyMatches } from '@/features/rfqs/hooks'

// The new-company form (and its form library) is downloaded when it is opened (perf/lcp).
const CreateCompanyInline = lazyWithReload(() => import('@/features/companies/CreateCompanyInline').then(m => ({ default: m.CreateCompanyInline })))

/*
 * "Search or add a supplier" on the RFQ page (the Suppliers to ask card, the Ask suppliers dialog, Enter reply from another supplier).
 * It searches every company on file by name (the same search as New RFQ's "Ask a supplier who is not listed"); when the name is not on
 * file the last row offers "Add “X” as a new supplier" and opens the same short form the customer picker uses (name, city, contact).
 * No role is stored on a company: it is a supplier from its first inquiry (v_company_roles), so a company added here is a supplier as
 * soon as it is recorded as asked, exactly as one added on Companies and then asked.
 */
export interface FoundSupplier {
  id: string
  name: string
  city: string | null
}

export function FindSupplier({ excludeIds, onPick, autoFocus }: { excludeIds?: ReadonlySet<string>; onPick: (s: FoundSupplier) => void; autoFocus?: boolean }) {
  const id = useId()
  const [text, setText] = useState('')
  const [creating, setCreating] = useState<string | null>(null)
  const matches = useCompanyMatches(text)
  const options = (matches.data ?? [])
    .filter(m => !excludeIds?.has(m.id))
    .map(m => ({ value: m.id, label: m.name, meta: [m.city, m.country].filter(Boolean).join(', ') || undefined }))
  return (
    <div className="grid max-w-md gap-2" data-slot="find-supplier">
      <label htmlFor={id} className="type-row">
        Search or add a supplier
      </label>
      <Combobox
        id={id}
        autoFocus={autoFocus}
        options={options}
        value=""
        onChange={v => {
          const hit = (matches.data ?? []).find(m => m.id === v)
          if (hit) {
            onPick({ id: hit.id, name: hit.name, city: hit.city ?? hit.country ?? null })
            setText('')
            setCreating(null)
          }
        }}
        onQueryChange={t => {
          setText(t)
          setCreating(null)
        }}
        onCreate={t => setCreating(t)}
        createLabel={t => `Add “${t}” as a new supplier`}
        loading={matches.isFetching}
        placeholder="Search companies"
      />
      {creating !== null ? (
        <Suspense fallback={null}>
          <CreateCompanyInline
            noun="supplier"
            submitVariant="secondary"
            initialName={creating}
            onCancel={() => setCreating(null)}
            onCreated={c => {
              onPick({ id: c.id, name: c.name, city: c.city ?? null })
              setCreating(null)
              setText('')
            }}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
