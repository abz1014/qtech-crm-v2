import { useEffect, useMemo } from 'react'
import { useSession } from '@/app/session'
import { businessToday } from '@/lib/dates'
import { computeReconciliationExceptions } from '@/lib/reconciliation'
import { openFindings } from '@/features/money/exceptions/checked'
import { useReconciliationInput } from '@/features/money/hooks'
import { useGstRegister } from '@/features/money/invoices/hooks'
import { needsAttention } from '@/features/money/invoices/model'
import { useClosedMonths, useMonthEndStatus } from '@/features/money/monthEnd/hooks'
import { buildChecklist, checksWithItems, defaultMonthEndMonth } from '@/features/money/monthEnd/model'
import { useBusinessToday, useTodayView } from '@/features/today/hooks'
import type { Role } from '@/features/today/types'

export type MoneyCounts = Record<string, number | undefined>

/**
 * The Money tab counts (MoneyFrame's comment says what each means), as a component of their own: they read Today's list, the
 * register and the month-end checks, so their code and reads come once the page has its data (perf/lcp). A page that reads the
 * same data (Invoices & GST, Month end) shares it, as before.
 */
export default function MoneyTabCounts({ onCounts }: { onCounts: (counts: MoneyCounts) => void }) {
  const session = useSession()
  const role = session.status === 'signed-in' ? session.user.role : ''
  const isAdmin = role === 'admin'
  const money = role === 'admin' || role === 'sales'
  const today = businessToday()
  const todayView = useTodayView({ id: session.status === 'signed-in' ? session.user.id : '', role: role as Role }, useBusinessToday())
  const register = useGstRegister(money)
  const monthEnd = defaultMonthEndMonth(today)
  const checks = useMonthEndStatus(monthEnd, isAdmin)
  const closed = useClosedMonths(isAdmin)
  const monthOpen = closed.data ? !closed.data.some(c => c.key === monthEnd) : false
  const recon = useReconciliationInput(isAdmin && monthOpen)
  const things = useMemo(
    () => (recon.data ? openFindings(session.status === 'signed-in' ? session.user.id : null, computeReconciliationExceptions(recon.data)).length : 0),
    [recon.data, session],
  )
  const counts: MoneyCounts = {
    receivables: todayView.view?.active.filter(i => i.rule === 'payment_overdue').length,
    'gst-register': register.data?.filter(needsAttention).length,
    'month-end': checks.data && monthOpen ? checksWithItems(buildChecklist(checks.data, monthEnd)) + (things > 0 ? 1 : 0) : undefined,
  }
  const key = JSON.stringify(counts)
  useEffect(() => {
    onCounts(JSON.parse(key) as MoneyCounts)
  }, [key, onCounts])
  return null
}
