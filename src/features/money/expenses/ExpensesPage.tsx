import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button } from '@/ui/Button'
import { MoneyFrame } from '@/features/money/MoneyFrame'
import { BurstSheet } from '@/features/money/expenses/BurstSheet'
import { AddExpenseDialog, type ExpenseContext } from '@/features/money/expenses/ExpenseDialog'
import { ExpensesTab } from '@/features/money/expenses/ExpensesTab'
import { useLegOptions, useOrderOptions } from '@/features/money/expenses/hooks'

/**
 * Money › Expenses: the frame, ONE way to add ("Add expenses": the burst sheet, which is just as quick for a single row; owner
 * decision 2026-10-19), and the list.
 *
 * `/money/expenses?add=1[&order=<id>[&leg=<id>]][&amount=384497][&note=Still owed on leg A]` opens the one Add expense
 * dialog with the context pre-filled (A3), so an order or a leg can offer "Add expense" as a plain link, and the screen
 * behind it is the Expenses list.
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

  const context = useMemo<ExpenseContext | undefined>(() => {
    if (!orderId) return undefined
    const leg = legId ? legs.data?.find(l => l.id === legId) : undefined
    const amount = Number(params.get('amount'))
    return {
      orderId,
      orderLabel: orders.data?.find(o => o.id === orderId)?.ref,
      legId: leg?.id,
      legLabel: leg?.label,
      payeeId: leg?.supplierId,
      payeeName: leg?.supplierName,
      amount: amount > 0 ? amount : undefined,
      amountNote: params.get('note') ?? undefined,
    }
  }, [orderId, legId, orders.data, legs.data, params])

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
        <Button variant="primary" icon={Plus} onClick={() => setBurst(true)}>
          Add expenses
        </Button>
      }
    >
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
      {linkReady ? <AddExpenseDialog open context={context} onOpenChange={o => !o && closeLinked()} /> : null}
    </MoneyFrame>
  )
}
