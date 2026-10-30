import { useState } from 'react'
import { UserRoundCog } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Select } from '@/ui/form/Select'
import { useToast } from '@/ui/useToast'
import { useOpenWork, useOwnerCandidates, useReassignOpenWork, useReassignOwner } from '@/features/owners/hooks'
import { workSentence, type OwnedKind } from '@/features/owners/api'

/*
 * Reassign owner (admin only). One dialog for one enquiry, job or order; one for all of a person's open work. Plain words: who takes it
 * over, and what stays (past credit toward targets stays with the person who earned it; payments from now on credit the new owner).
 */
const CREDIT_NOTE = 'Payments already received keep their credit toward targets. Payments received from now on credit the new owner.'

export function OwnerPicker({ value, onChange, exclude }: { value: string; onChange: (v: string) => void; exclude?: string }) {
  const people = useOwnerCandidates()
  const options = (people.data ?? []).filter(p => p.id !== exclude).map(p => ({ value: p.id, label: p.name }))
  return <Select aria-label="New owner" value={value} onChange={e => onChange(e.target.value)} placeholder="Choose the new owner" options={options} />
}

export function ReassignOwnerDialog({
  kind,
  id,
  label,
  currentOwnerId,
  currentOwnerName,
  onClose,
}: {
  kind: OwnedKind
  id: string
  label: string
  currentOwnerId: string | null
  currentOwnerName: string | null
  onClose: () => void
}) {
  const { toast } = useToast()
  const reassign = useReassignOwner()
  const [to, setTo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    setError(null)
    try {
      await reassign.mutateAsync({ kind, id, to })
      toast({ title: 'Owner changed', body: label, tone: 'success' })
      onClose()
    } catch (err) {
      setError(mapPgError(err, { entity: 'owner' }).message)
    }
  }
  return (
    <Dialog open onOpenChange={o => !o && !reassign.isPending && onClose()} busy={reassign.isPending}>
      <DialogContent
        title="Reassign owner"
        context={`${label}${currentOwnerName ? ` · now ${currentOwnerName}` : ' · no owner'}`}
        icon={UserRoundCog}
        size="sm"
        footer={
          <>
            <Button data-cancel disabled={reassign.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" busy={reassign.isPending} busyLabel="Saving" disabled={!to} onClick={() => void submit()}>
              Change owner
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          {error ? (
            <Banner tone="danger" title="Couldn't change the owner">
              {error}
            </Banner>
          ) : null}
          <OwnerPicker value={to} onChange={setTo} exclude={currentOwnerId ?? undefined} />
          <p className="text-sm text-fg-muted">
            {kind === 'job' ? 'The enquiry and the orders that came from it move together. ' : ''}
            {CREDIT_NOTE}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** "Move all of X's open work to Y". Used from the Team list. */
export function ReassignWorkDialog({ fromId, fromName, onClose }: { fromId: string; fromName: string; onClose: () => void }) {
  const { toast } = useToast()
  const work = useOpenWork(fromId)
  const move = useReassignOpenWork()
  const [to, setTo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const total = (work.data?.rfqs ?? 0) + (work.data?.orders ?? 0)
  const submit = async () => {
    setError(null)
    try {
      const done = await move.mutateAsync({ from: fromId, to })
      toast({ title: 'Open work moved', body: `${workSentence(done)} moved from ${fromName}`, tone: 'success' })
      onClose()
    } catch (err) {
      setError(mapPgError(err, { entity: 'owner' }).message)
    }
  }
  return (
    <Dialog open onOpenChange={o => !o && !move.isPending && onClose()} busy={move.isPending}>
      <DialogContent
        title={`Move ${fromName}'s open work`}
        icon={UserRoundCog}
        size="sm"
        footer={
          <>
            <Button data-cancel disabled={move.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" busy={move.isPending} busyLabel="Moving" disabled={!to || total === 0} onClick={() => void submit()}>
              Move it all
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          {error ? (
            <Banner tone="danger" title="Couldn't move the work">
              {error}
            </Banner>
          ) : null}
          <p className="text-sm" data-testid="open-work-sentence">
            {work.isPending ? 'Counting their open work' : `${fromName} has ${workSentence(work.data ?? { rfqs: 0, orders: 0 })}.`}
          </p>
          <OwnerPicker value={to} onChange={setTo} exclude={fromId} />
          <p className="text-sm text-fg-muted">Closed enquiries, cancelled and finished orders stay as they are. {CREDIT_NOTE}</p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
