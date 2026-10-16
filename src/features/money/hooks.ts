import { useQuery } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { listOrderMargins } from '@/features/money/margins/api'
import { getReconciliationInput } from '@/features/money/exceptions/api'

/** Every order's margin row. Admin only (`enabled`). */
export function useOrderMargins(enabled: boolean) {
  return useQuery({ queryKey: qk.money.margins(), queryFn: listOrderMargins, enabled })
}

/** The rows the reconciliation checks read. Admin only (`enabled`). */
export function useReconciliationInput(enabled: boolean) {
  return useQuery({ queryKey: qk.money.exceptions(), queryFn: getReconciliationInput, enabled })
}
