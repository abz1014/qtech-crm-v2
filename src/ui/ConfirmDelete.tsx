import { useRef, useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Checkbox } from '@/ui/form/Checkbox'

/*
 * ConfirmDelete: the ONE confirm for deleting a record (owner decision 2026-10-22, from the expense delete). Every delete button asks
 * through this, so they read and behave the same:
 *   title        "Delete <thing>?"
 *   summary      one line saying exactly what is about to go
 *   also         what else goes with it ("Also deletes: 2 issued quotations (QT-26-0012 R0, R1), 5 supplier prices, 3 files")
 *   warning      "This can't be undone."
 *   buttons      [Delete] (red, never green) and [Cancel]
 * Delete runs `onConfirm` at once. While it runs the dialog is busy (Esc, the scrim and Cancel are held) and a second tap does
 * nothing. If it throws, the server's sentence is shown in the dialog, where the tap was, and the record stays; the caller shows
 * its "deleted" toast only after `onConfirm` has resolved, which closes the dialog. `blocked` replaces Delete with a reason the
 * record cannot be deleted (the only button left is OK). `tick` adds a warning and a box that must be ticked before Delete is
 * pressable (a warning that never blocks, e.g. a GST return that may already be filed). 16px text, 44px buttons, a bottom sheet
 * on a phone (Dialog).
 */
export interface ConfirmDeleteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What is deleted, in the title: "RFQ-0177", "this expense". */
  thing: string
  summary?: ReactNode
  /** What else goes with it, as short phrases; shown as "Also deletes: a, b, c". */
  also?: readonly string[]
  /** The counts are still loading: Delete waits (it must not run before the person has read what goes with it). */
  loading?: boolean
  /** The record cannot be deleted: this sentence is shown instead of the warning, and there is no Delete button. */
  blocked?: ReactNode
  /** A warning with a box to tick: Delete stays disabled until it is ticked. Not a block: the person can tick and go on. */
  tick?: { warning: ReactNode; label: ReactNode }
  /** Runs the delete. Resolve when the server has confirmed; throw to keep the dialog open with the message. */
  onConfirm: () => Promise<void>
  /** Words for a thrown error. Default: the plain sentence of mapPgError. */
  errorMessage?: (e: unknown) => string
  /** Also called with the error (a caller that wants a toast as well). */
  onError?: (e: unknown) => void
}

export function ConfirmDelete({
  open,
  onOpenChange,
  thing,
  summary,
  also,
  loading = false,
  blocked,
  tick,
  onConfirm,
  errorMessage,
  onError,
}: ConfirmDeleteProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ticked, setTicked] = useState(false)
  // A second tap in the same tick sees the state from before the first; the ref does not.
  const running = useRef(false)

  const run = async () => {
    if (running.current || loading || blocked || (tick && !ticked)) return
    running.current = true
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (e) {
      setError(errorMessage ? errorMessage(e) : mapPgError(e).message)
      onError?.(e)
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  const change = (next: boolean) => {
    if (next || running.current) return
    setError(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={change} busy={busy}>
      <DialogContent
        title={`Delete ${thing}?`}
        icon={Trash2}
        tone="danger"
        size="sm"
        footer={
          <>
            <Button size="lg" data-cancel onClick={() => change(false)} disabled={busy}>
              {blocked ? 'OK' : 'Cancel'}
            </Button>
            {blocked ? null : (
              <Button size="lg" variant="danger" onClick={() => void run()} busy={busy} busyLabel="Deleting" disabled={loading || (!!tick && !ticked)}>
                Delete
              </Button>
            )}
          </>
        }
      >
        <div className="grid gap-2 text-base" data-confirm-delete>
          {summary ? (
            <p className="font-medium" data-slot="delete-summary">
              {summary}
            </p>
          ) : null}
          {also && also.length > 0 ? (
            <p data-slot="delete-also">
              <span className="font-medium">Also deletes:</span> {also.join(', ')}
            </p>
          ) : null}
          {loading ? <p className="text-fg-muted">Checking what goes with it…</p> : null}
          {tick && !blocked ? (
            <div role="group" aria-label="Warning" data-slot="delete-tick" className="grid gap-2 rounded-row border border-tone-warning-fg/25 bg-tone-warning-bg px-3 py-3">
              <p className="font-medium">{tick.warning}</p>
              <Checkbox label={tick.label} checked={ticked} onCheckedChange={c => setTicked(c === true)} />
            </div>
          ) : null}
          {blocked ? (
            <p role="alert" data-slot="delete-blocked" className="font-medium text-tone-danger-fg">
              {blocked}
            </p>
          ) : (
            <p>This can’t be undone.</p>
          )}
          {error ? (
            <p role="alert" className="text-tone-danger-fg">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
