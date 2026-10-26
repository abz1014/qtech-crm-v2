import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import * as inOut from '@/features/money/inOut/api'
import { usePayables, usePnlMonths } from '@/features/money/monthEnd/hooks'
import { buildPayables } from '@/features/money/monthEnd/model'
import { useReceivablesSummary } from '@/features/money/payments/hooks'
import { moneyHomeFigures } from '@/features/money/home/model'

const live = { staleTime: 0 } as const

/** The four numbers of Money home, admin only (`enabled`). Live like every money figure: opening the page reads the books again. */
export function useMoneyHome(today: string, enabled = true) {
  const summary = useReceivablesSummary(today, enabled)
  const flows = useQuery({ queryKey: qk.money.monthEnd.cashFlow(), queryFn: inOut.loadCashFlow, enabled, ...live })
  const profits = useQuery({ queryKey: [...qk.money.monthEnd.cashFlow(), 'profit'], queryFn: inOut.loadProfit, enabled, ...live })
  const pnl = usePnlMonths(enabled)
  const payables = usePayables(today, enabled)
  const owed = useMemo(() => (payables.data ? buildPayables(today, payables.data) : null), [payables.data, today])
  const figures = useMemo(
    () =>
      moneyHomeFigures({
        today,
        summary: summary.data ?? null,
        flows: flows.data ?? null,
        pnl: pnl.data ?? null,
        profits: profits.data ?? null,
        owed: owed ? { total: owed.owed, count: owed.owedCount } : null,
      }),
    [today, summary.data, flows.data, pnl.data, profits.data, owed],
  )
  const all = [summary, flows, profits, pnl, payables]
  return { figures, isError: all.some(q => q.isError), refetch: () => all.forEach(q => void q.refetch()) }
}
