import { useQuery } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/reports/api'

/* Reports (P01). Read-only; always re-read on open, because the numbers move whenever an RFQ is closed or an order placed. */
export const useOutcomes = () => useQuery({ queryKey: qk.reports.outcomes(), queryFn: api.listOutcomes, staleTime: 0 })
export const useFloatReport = () => useQuery({ queryKey: qk.reports.float(), queryFn: api.listFloat, staleTime: 0 })
export const useTurnaround = () => useQuery({ queryKey: qk.reports.turnaround(), queryFn: api.listTurnaround, staleTime: 0 })
export const useRepeatCustomers = () =>
  useQuery({ queryKey: qk.reports.repeatCustomers(), queryFn: api.listRepeatCustomers, staleTime: 0 })
