import { useState } from 'react'
import { Archive } from 'lucide-react'
import type { ArchiveSetting } from '@/features/settings/archive/api'
import { useSetArchive } from '@/features/settings/archive/hooks'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { CARD } from '@/ui/card'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { controlClass } from '@/ui/form/fieldContext'
import { StatusText } from '@/ui/StatusText'
import { useToast } from '@/ui/useToast'

/*
 * The status card: is archiving on, and from which date. Every change asks first and says what will happen; the database call is
 * archive_set, and after it every list in the app reads itself again (hooks.ts).
 */
interface Pending {
  enabled: boolean
  cutoff: string
}

export function StatusCard({ setting, cutoff, onCutoff }: { setting: ArchiveSetting; cutoff: string; onCutoff: (v: string) => void }) {
  const toast = useToast()
  const save = useSetArchive()
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)
  const changed = cutoff !== setting.cutoff
  const validCutoff = /^\d{4}-\d{2}-\d{2}$/.test(cutoff)

  const ask = (p: Pending) => {
    setError(null)
    setPending(p)
  }
  const confirm = async () => {
    if (!pending) return
    try {
      await save.mutateAsync(pending)
      toast.toast({ title: pending.enabled ? 'Archiving is on' : 'Archiving is off', tone: 'success' })
      setPending(null)
    } catch (e) {
      setError(mapPgError(e, { entity: 'archive' }).message)
    }
  }

  const on = setting.enabled
  const title = !pending ? '' : !pending.enabled ? 'Switch archiving off?' : on ? 'Change the archive date?' : 'Switch archiving on?'
  const body = !pending
    ? ''
    : !pending.enabled
      ? 'Every record will show in the lists again, old and imported ones included. Nothing is deleted or changed.'
      : `Records dated before ${formatDay(pending.cutoff)}, and every imported record, will be kept but hidden from lists and search. Totals and reports still count them. You can bring any record back one by one, or switch this off.`

  return (
    <section className={cn(CARD, 'grid gap-4 p-card')} aria-label="Archive status" data-testid="archive-status">
      <div className="flex flex-wrap items-center gap-3">
        <Archive aria-hidden className="size-5 text-fg-muted" />
        <h2 className="text-lg font-card">Archive is</h2>
        <span data-testid="archive-state">
          <StatusText tone={on ? 'done' : 'inert'}>{on ? 'On' : 'Off'}</StatusText>
        </span>
      </div>
      <p className="max-w-prose text-base text-fg-2">
        Records dated before {formatDay(setting.cutoff)} are kept but hidden from lists. Totals still count them.{' '}
        {on ? '' : 'Archiving is off, so nothing is hidden yet.'}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm font-medium">
          Archive records dated before
          <input type="date" className={cn(controlClass, 'num w-auto')} value={cutoff} max={businessToday()} onChange={e => onCutoff(e.target.value)} />
        </label>
        {on && changed ? (
          <Button disabled={!validCutoff} onClick={() => ask({ enabled: true, cutoff })}>
            Change date
          </Button>
        ) : null}
        {on ? (
          <Button variant="secondary" onClick={() => ask({ enabled: false, cutoff: setting.cutoff })}>
            Switch off
          </Button>
        ) : (
          <Button disabled={!validCutoff} onClick={() => ask({ enabled: true, cutoff })}>
            Switch on
          </Button>
        )}
      </div>
      <Dialog open={pending !== null} onOpenChange={o => !o && !save.isPending && setPending(null)} busy={save.isPending}>
        <DialogContent
          title={title}
          icon={Archive}
          size="sm"
          footer={
            <>
              <Button size="lg" data-cancel onClick={() => setPending(null)} disabled={save.isPending}>
                Cancel
              </Button>
              <Button size="lg" onClick={() => void confirm()} busy={save.isPending} busyLabel="Saving">
                {pending && !pending.enabled ? 'Switch off' : on ? 'Change date' : 'Switch on'}
              </Button>
            </>
          }
        >
          <div className="grid gap-2 text-base">
            <p>{body}</p>
            {error ? (
              <p role="alert" className="font-medium text-tone-danger-fg">
                {error}
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
