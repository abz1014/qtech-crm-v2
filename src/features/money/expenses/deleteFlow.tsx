import { useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { formatShortDate } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { useToast } from '@/ui/useToast'
import { useDeleteExpense } from '@/features/money/expenses/hooks'
import { pkr, type ListedExpense } from '@/features/money/expenses/model'

/*
 * The ONE way an expense is deleted (owner decision 2026-10-22): a confirm that names the expense, then the delete runs at once
 * and is permanent (the audit log keeps the row). "Expense deleted" shows only after the server confirms; on an error the
 * server's sentence is shown and the row stays. Used by the dialog's Delete button and the row's "⋯" menu, on phone and desktop.
 */
export const CLOSED_MONTH_LINE = 'Month closed. Reopen it on Month end to change or delete.'

/** The database says "An admin can reopen it."; the screen says where. */
export function deleteErrorMessage(e: unknown): string {
  return mapPgError(e, { entity: 'expense' }).message.replace(/An admin can reopen it\.?$/, 'Reopen it on Month end first.')
}

export function useDeleteExpenseFlow(categoryName: (r: ListedExpense) => string, onDeleted?: (r: ListedExpense) => void) {
  const del = useDeleteExpense()
  const toast = useToast()
  const [target, setTarget] = useState<ListedExpense | null>(null)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    if (!target) return
    try {
      await del.mutateAsync(target.id)
    } catch (e) {
      // The row stays; the sentence is on the confirm so it is read where the tap was.
      setError(deleteErrorMessage(e))
      toast.toast({ title: "Couldn't delete the expense", body: deleteErrorMessage(e), tone: 'danger' })
      return
    }
    const r = target
    setTarget(null)
    toast.toast({ title: 'Expense deleted', body: `${categoryName(r)} · ${pkr(r.amount)}`, tone: 'success' })
    onDeleted?.(r)
  }

  const close = (open: boolean) => {
    if (open || del.isPending) return
    setTarget(null)
    setError(null)
  }

  const node: ReactNode = target ? (
    <Dialog open onOpenChange={close} busy={del.isPending}>
      <DialogContent
        title="Delete this expense?"
        icon={Trash2}
        tone="danger"
        size="sm"
        footer={
          <>
            <Button size="lg" data-cancel onClick={() => close(false)} disabled={del.isPending}>
              Cancel
            </Button>
            <Button size="lg" variant="secondary" className="border-tone-danger-fg text-tone-danger-fg" onClick={() => void confirm()} busy={del.isPending} busyLabel="Deleting">
              Delete
            </Button>
          </>
        }
      >
        <div className="grid gap-2 text-base">
          <p className="font-medium" data-testid="delete-expense-what">
            {categoryName(target)} · {pkr(target.amount)} · {formatShortDate(target.paidOn, undefined, true)}
          </p>
          <p>This can’t be undone.</p>
          {error ? (
            <p role="alert" className="text-tone-danger-fg">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  ) : null

  return {
    /** Opens the confirm for this expense. */
    ask: (r: ListedExpense) => {
      setError(null)
      setTarget(r)
    },
    node,
  }
}
