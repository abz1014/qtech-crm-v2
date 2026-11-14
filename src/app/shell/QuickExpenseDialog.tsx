import { ReceiptText } from 'lucide-react'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Skeleton } from '@/ui/Skeleton'
import { QuickAdd } from '@/features/money/expenses/QuickAdd'
import { useCategories } from '@/features/money/expenses/hooks'

/*
 * "Add an expense" from anywhere (redesign phase 3, L1-X): the E key and + New > Expense open Quick add (money/expenses/QuickAdd.tsx,
 * the same one that sits on the Expenses screen) in a dialog: amount, tap a category, Save. The row stays open for the next one and
 * keeps its running total, so five receipts are five amounts and taps. Admin only (expenses are admin only, 0010). Loaded lazily by
 * PaletteHost: it costs nothing until someone asks.
 */
export function QuickExpenseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const cats = useCategories(open)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add an expense" icon={ReceiptText} size="lg">
        {cats.data ? <QuickAdd categories={cats.data} /> : cats.isError ? <p className="text-base text-tone-danger-fg">Expense categories could not load. Check the connection and try again.</p> : <QuickAddLoading />}
      </DialogContent>
    </Dialog>
  )
}

/** Shaped like Quick add while the categories load: the amount, the six category tiles, Paid via and Save. */
function QuickAddLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading the expense categories" className="grid gap-4">
      <span className="grid gap-2">
        <Skeleton className="h-4 w-[6rem]" />
        <Skeleton className="h-touch w-full" />
      </span>
      <span className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <Skeleton key={i} className="h-touch w-full" />
        ))}
      </span>
      <span className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-touch w-[10rem]" />
        <Skeleton className="h-touch w-[7rem]" />
      </span>
    </div>
  )
}
