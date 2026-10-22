import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Rows3 } from 'lucide-react'
import { Button } from '@/ui/Button'
import { MoneyFrame } from '@/features/money/MoneyFrame'
import { BurstSheet } from '@/features/money/expenses/BurstSheet'
import { CashInHandLine } from '@/features/money/expenses/CashInHand'
import { ClaimsReview } from '@/features/money/expenses/ClaimsReview'
import { AddExpenseDialog, type ExpenseContext } from '@/features/money/expenses/ExpenseDialog'
import { ExpensesTab } from '@/features/money/expenses/ExpensesTab'
import { PayDialog } from '@/features/money/expenses/PayDialog'
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
  // /money/expenses?burst=1 opens the sheet straight away (the Month end empty state links here).
  const [burst, setBurst] = useState(() => params.get('burst') !== null)
  const linked = params.get('add') !== null
  const orderId = params.get('order')
  const legId = params.get('leg')
  const orders = useOrderOptions(linked && !!orderId)
  const legs = useLegOptions(linked ? orderId : null)
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
      {cats.data ? <ClaimsReview categories={cats.data} groups={groups.data ?? []} /> : null}
      {cats.data ? <QuickAdd categories={cats.data} /> : <div className="h-[220px] animate-pulse rounded border bg-sunken" aria-hidden="true" />}
      <CashInHandLine />
      <ExpensesTab />
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
          context={{ orderId: context.orderId as string, orderLabel: context.orderLabel, legId: leg.id, supplierId: leg.supplierId, supplierName: leg.supplierName, amount: context.amount, amountNote: context.amountNote }}
        />
      ) : linkReady && !legId ? (
        <AddExpenseDialog open context={context} onOpenChange={o => !o && closeLinked()} />
      ) : null}
    </MoneyFrame>
  )
}
