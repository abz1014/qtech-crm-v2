import { useMemo, useState } from 'react'
import { GitMerge } from 'lucide-react'
import { useCompanyList, useMergeCompanies } from '@/features/companies/hooks'
import { mapPgError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Combobox, type ComboOption } from '@/ui/form/Combobox'
import { Field } from '@/ui/form/Field'

/*
 * Admin merge (R02). The company you are on is the duplicate: it is removed, and everything on it (RFQs,
 * orders, enquiries, contacts, sites, brands) moves to the company you pick. The database function
 * merge_companies does the move in one transaction and refuses a clash it cannot settle on its own (the
 * same RFQ sent to both, the same customer reference or PO number under both) with a plain sentence.
 */
export interface MergeSubject {
  id: string
  name: string
  rfqs: number
  orders: number
  contacts: number
  sites: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  subject: MergeSubject
  onMerged: (keep: { id: string; name: string }) => void
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

export function MergeCompanyDialog({ open, onOpenChange, subject, onMerged }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <MergeBody onOpenChange={onOpenChange} subject={subject} onMerged={onMerged} /> : null}
    </Dialog>
  )
}

function mergeMessage(err: unknown): string {
  const e = err as { code?: string; message?: string }
  if (e?.code === '23505' && /^merge conflict/i.test(e.message ?? '')) {
    return `${(e.message ?? '').replace(/^merge conflict:\s*/i, '').replace(/^./, c => c.toUpperCase())}. Nothing was changed. Fix that on one of the two companies, then merge again.`
  }
  if (e?.code === '42501') return 'Only an admin can merge companies. Nothing was changed.'
  return mapPgError(err).message
}

function MergeBody({ onOpenChange, subject, onMerged }: Omit<Props, 'open'>) {
  const list = useCompanyList()
  const merge = useMergeCompanies()
  const [keepId, setKeepId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const options = useMemo<ComboOption[]>(
    () =>
      (list.data ?? [])
        .filter(c => c.id !== subject.id)
        .map(c => ({ value: c.id, label: c.name, meta: c.country ?? undefined })),
    [list.data, subject.id],
  )
  const keep = options.find(o => o.value === keepId)

  const moves = [
    plural(subject.rfqs, 'RFQ'),
    plural(subject.orders, 'order'),
    plural(subject.contacts, 'contact'),
    plural(subject.sites, 'site'),
  ].join(', ')

  async function confirm() {
    if (!keep) return
    setError(null)
    try {
      await merge.mutateAsync({ keepId: keep.value, dropId: subject.id })
      onOpenChange(false)
      onMerged({ id: keep.value, name: keep.label })
    } catch (err) {
      setError(mergeMessage(err))
    }
  }

  return (
    <DialogContent
      title="Merge duplicate company"
      icon={GitMerge}
      tone="danger"
      context={`${subject.name} is the duplicate.`}
      footer={
        <>
          <Button data-cancel onClick={() => onOpenChange(false)} disabled={merge.isPending}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!keep} busy={merge.isPending} busyLabel="Merging" onClick={() => void confirm()}>
            {keep ? `Merge into ${keep.label}` : 'Merge'}
          </Button>
        </>
      }
    >
      {error ? (
        <Banner tone="danger" title="Couldn't merge these companies">
          {error}
        </Banner>
      ) : null}
      <Field label="Merge into" help="Pick the company to keep.">
        <Combobox
          options={options}
          value={keepId}
          onChange={setKeepId}
          loading={list.isPending}
          placeholder="Start typing a company name"
          autoComplete="off"
        />
      </Field>
      {keep ? (
        <p>
          <b className="font-medium text-fg">{subject.name}</b> will be removed. Its {moves} move to <b className="font-medium text-fg">{keep.label}</b>. This
          cannot be undone.
        </p>
      ) : (
        <p>Everything on {subject.name} moves to the company you pick, and {subject.name} is removed. Nothing is changed until you confirm.</p>
      )}
    </DialogContent>
  )
}
