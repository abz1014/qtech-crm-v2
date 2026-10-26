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
        {cats.data ? <QuickAdd categories={cats.data} /> : cats.isError ? <p className="text-base text-tone-danger-fg">Expense categories could not load. Check your signal and try again.</p> : <Skeleton className="h-[220px] w-full" />}
      </DialogContent>
    </Dialog>
  )
}
