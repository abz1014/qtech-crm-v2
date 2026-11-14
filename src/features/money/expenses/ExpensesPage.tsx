import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Rows3 } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { CARD } from '@/ui/card'
import { Skeleton } from '@/ui/Skeleton'
import { MoneyFrame } from '@/features/money/MoneyFrame'
import { BurstSheet } from '@/features/money/expenses/BurstSheet'
import { CashInHandLine } from '@/features/money/expenses/CashInHand'
import { ClaimsReview } from '@/features/money/expenses/ClaimsReview'
import { OwedToStaff } from '@/features/money/expenses/OwedToStaff'
import { AddExpenseDialog, type ExpenseContext } from '@/features/money/expenses/ExpenseDialog'
import { ExpensesTab } from '@/features/money/expenses/ExpensesTab'
import { MiscPromoteBanners } from '@/features/money/expenses/MiscPromote'
import { PayDialog } from '@/features/money/expenses/PayDialog'
import { RecurringPanel } from '@/features/money/expenses/RecurringPanel'
import { QuickAdd } from '@/features/money/expenses/QuickAdd'
import { useCategories, useGroups, useLegOptions, useOrderOptions } from '@/features/money/expenses/hooks'

/**
 * Money › Expenses. From the top: "To approve" (engineers' "I paid", only while there are some), Quick add (amount, tap a category,
 * Save; it stays open: redesign phase 1), cash in hand, then the monthly bills and the month's list. "Add expenses" (the 0086
 * multi-row sheet) stays for a batch of receipts; Quick add's Save is the page's one green button.
 *
 * `/money/expenses?add=1[&order=<id>][&amount=384497][&note=...]` opens the one Add expense dialog with the context pre-filled (A3).
 * With `&leg=<id>` it opens Pay <supplier> instead: supplier payments have one door (Pay on the supplier order or on We owe
 * suppliers), and that is the dialog both open.
 */
export function ExpensesPage() {
  const [params, setParams] = useSearchParams()
  // /money/expenses?burst=1 opens the sheet straight away (the Lock a month empty state links here).
  const [burst, setBurst] = useState(() => params.get('burst') !== null)
  const linked = params.get('add') !== null
  const orderId = params.get('order')
  const legId = params.get('leg')
  const orders = useOrderOptions(linked && !!orderId)
  const legs = useLegOptions(linked ? orderId : null)
  const today = businessToday()
  const cats = useCategories()
  const groups = useGroups()

  const leg = legId ? legs.data?.find(l => l.id === legId) : undefined
  const context = useMemo<ExpenseContext | undefined>(() => {
    if (!orderId) return undefined
    const amount = Number(params.get('amount'))
    return {
      orderId,
      orderLabel: orders.data?.find(o => o.id === orderId)?.ref,
      amount: amount > 0 ? amount : undefined,
      amountNote: params.get('note') ?? undefined,
    }
  }, [orderId, orders.data, params])

  const linkReady = linked && (!orderId || (orders.isSuccess && (!legId || legs.isSuccess)))
  const closeLinked = () => {
    const next = new URLSearchParams(params)
    for (const k of ['add', 'order', 'leg', 'amount', 'note']) next.delete(k)
    setParams(next, { replace: true })
  }

  return (
    <MoneyFrame
      active="expenses"
      actions={
        <Button icon={Rows3} onClick={() => setBurst(true)} className="text-base">
          Add expenses
        </Button>
      }
    >
      {/* Desktop (lg): the list in the main column, the side panels in a narrow one. The wrappers are `contents` below lg, so a phone and a
          tablet keep one column and the order classes: claims, Quick add, then (phone) the list, Recurring, cash / (tablet) cash, Recurring, the list. */}
      <div className="grid gap-card-gap lg:grid-cols-[minmax(0,1fr)_minmax(0,21.25rem)] lg:items-start">
        <div className="contents lg:grid lg:min-w-0 lg:gap-card-gap">
          <div className="order-2 min-w-0">
            {cats.data ? <QuickAdd categories={cats.data} sheetOpen={burst} /> : <QuickAddSkeleton />}
          </div>
          <div className="order-5 min-w-0 max-sm:order-3">
            <ExpensesTab />
          </div>
        </div>
        <div className="contents lg:grid lg:min-w-0 lg:gap-card-gap">
          {/* To approve and Claims to repay (one card row each on a phone) come first while there are any; cash and the misc banners follow the list on a phone. */}
          <div className="order-1 grid min-w-0 gap-card-gap empty:hidden">
            {cats.data ? <ClaimsReview categories={cats.data} groups={groups.data ?? []} /> : null}
            <OwedToStaff />
          </div>
          <div className="order-3 grid min-w-0 gap-card-gap empty:hidden max-sm:order-5">
            <CashInHandLine fold />
            <MiscPromoteBanners />
          </div>
          <div className="order-4 min-w-0 empty:hidden">{cats.data ? <RecurringPanel categories={cats.data} today={today} /> : null}</div>
        </div>
      </div>
      <BurstSheet
        open={burst}
        onOpenChange={o => {
          setBurst(o)
          if (!o && params.get('burst') !== null) {
            const next = new URLSearchParams(params)
            next.delete('burst')
            setParams(next, { replace: true })
          }
        }}
      />
      {linkReady && leg && context ? (
        <PayDialog
          open
          onOpenChange={o => !o && closeLinked()}
          context={{ orderId: context.orderId as string, orderLabel: context.orderLabel, legId: leg.id, supplierId: leg.supplierId, supplierName: leg.supplierName, currency: leg.currency, amount: context.amount, amountNote: context.amountNote }}
        />
      ) : linkReady && !legId ? (
        <AddExpenseDialog open context={context} onOpenChange={o => !o && closeLinked()} />
      ) : null}
    </MoneyFrame>
  )
}

/** Quick add while the categories load: the card's shape (title line, the amount box and Save, a row of category buttons). */
function QuickAddSkeleton() {
  return (
    <div className={cn(CARD, 'grid gap-4 p-card')} aria-hidden="true">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-6 w-1/5" />
        <Skeleton className="h-5 w-1/3 max-sm:hidden" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-control-lg flex-1" />
        <Skeleton className="h-control-lg w-[7rem]" />
      </div>
      <div className="flex flex-wrap gap-2">
        {[24, 32, 20, 28, 16].map(w => (
          <Skeleton key={w} className="h-control rounded-pill" style={{ width: `${w / 4}rem` }} />
        ))}
      </div>
    </div>
  )
}
