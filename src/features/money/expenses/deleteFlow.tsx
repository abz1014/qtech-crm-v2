import { useState, type ReactNode } from 'react'
import { formatShortDate } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { ConfirmDelete } from '@/ui/ConfirmDelete'
import { useToast } from '@/ui/useToast'
import { useDeleteExpense } from '@/features/money/expenses/hooks'
import { pkr, type ListedExpense } from '@/features/money/expenses/model'

/*
 * The ONE way an expense is deleted (owner decision 2026-10-22): a confirm that names the expense, then the delete runs at once
 * and is permanent (the audit log keeps the row). "Expense deleted" shows only after the server confirms; on an error the
 * server's sentence is shown and the row stays. Used by the dialog's Delete button and the row's "⋯" menu, on phone and desktop.
 */
export const CLOSED_MONTH_LINE = 'Month closed. Reopen the month first, in Lock a month, to change or delete.'

/** The database says "An admin can reopen it."; the screen says where. */
export function deleteErrorMessage(e: unknown): string {
  return mapPgError(e, { entity: 'expense' }).message.replace(/An admin can reopen it\.?$/, 'Reopen the month first, in Lock a month.')
}

export function useDeleteExpenseFlow(categoryName: (r: ListedExpense) => string, onDeleted?: (r: ListedExpense) => void) {
  const del = useDeleteExpense()
  const toast = useToast()
  const [target, setTarget] = useState<ListedExpense | null>(null)

  const confirm = async () => {
    if (!target) return
    const r = target
    await del.mutateAsync(r.id)
    toast.toast({ title: 'Expense deleted', body: `${categoryName(r)} · ${pkr(r.amount)}`, tone: 'success' })
    onDeleted?.(r)
  }

  const node: ReactNode = target ? (
    <ConfirmDelete
      open
      onOpenChange={open => {
        if (!open) setTarget(null)
      }}
      thing="this expense"
      summary={
        <span data-testid="delete-expense-what">
          {categoryName(target)} · {pkr(target.amount)} · {formatShortDate(target.paidOn, undefined, true)}
        </span>
      }
      onConfirm={confirm}
      errorMessage={deleteErrorMessage}
      // The row stays; the sentence is on the confirm so it is read where the tap was, and again as a toast.
      onError={e => toast.toast({ title: "Couldn't delete the expense", body: deleteErrorMessage(e), tone: 'danger' })}
    />
  ) : null

  return {
    /** Opens the confirm for this expense. */
    ask: (r: ListedExpense) => setTarget(r),
    node,
  }
}
