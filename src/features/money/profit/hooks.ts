import { useQuery } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/money/profit/api'

/*
 * Profitability, admin only (`enabled`). The same keys and readers as In vs out, so the two share one read of each view; like the
 * month-end reports nothing is kept for later (staleTime 0): opening the page reads the books again.
 */
const live = { staleTime: 0 } as const

/** Costs on enquiries that were closed without an order (v_enquiry_costs). Its own read: the profit figures never wait for it. */
export function useLostEnquiryCosts(enabled = true) {
  return useQuery({ queryKey: [...qk.money.monthEnd.cashFlow(), 'lost-enquiries'], queryFn: api.loadLostEnquiryCosts, enabled, ...live })
}

export function useProfitPage(enabled = true) {
  const flows = useQuery({ queryKey: qk.money.monthEnd.cashFlow(), queryFn: api.loadCashFlow, enabled, ...live })
  const profit = useQuery({ queryKey: [...qk.money.monthEnd.cashFlow(), 'profit'], queryFn: api.loadProfit, enabled, ...live })
  return {
    flows: flows.data,
    profit: profit.data,
    isPending: flows.isPending || profit.isPending,
    isError: flows.isError || profit.isError,
    refetch: () => {
      void flows.refetch()
      void profit.refetch()
    },
  }
}
