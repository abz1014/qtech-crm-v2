import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSession } from '@/app/session'
import { monthEnd } from '@/features/money/expenses/model'
import {
  useAging,
  useCategoryLines,
  useGstMonths,
  usePaymentStats,
  usePayables,
  usePnlMonths,
  useTeamMonth,
  useViaStat,
} from '@/features/money/monthEnd/hooks'
import {
  buildAging,
  buildCategories,
  buildGst,
  buildPayables,
  buildPnl,
  buildTeam,
  type AgingView,
  type CategoryView,
  type GstView,
  type PayablesView,
  type PnlView,
  type TeamView,
} from '@/features/money/monthEnd/model'

/*
 * One hook per report. Each reads what its report needs, builds the figures in model.ts and says whether it is still loading
 * or failed, so a report page and the checklist's "Reports for October" list share one source and cannot disagree.
 */
interface Report<T> {
  view: T | null
  isPending: boolean
  isError: boolean
  refetch: () => void
}

/**
 * An as-of day from the address that may be used: a real calendar day (not 2026-02-30), from 2000 on and not after today
 * (HE-22). Anything else falls back to the default as-of, so a mistyped link still shows the report.
 */
export function isUsableAsOf(s: string | null, today: string): s is string {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null
  if (!m || !s) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  const real = date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
  return real && s >= '2000-01-01' && s <= today
}

/** The date aging and "we owe" are read as of: the month's last day (never in the future), or a day the person chose. */
export function useAsOf(month: string, today: string): { asOf: string; chosen: boolean; setAsOf: (d: string | null) => void } {
  const [params, setParams] = useSearchParams()
  const asked = params.get('asof')
  const chosen = isUsableAsOf(asked, today)
  const end = monthEnd(month)
  const asOf = chosen ? asked : end > today ? today : end
  const setAsOf = (d: string | null) => {
    const next = new URLSearchParams(params)
    if (d) next.set('asof', d)
    else next.delete('asof')
    setParams(next, { replace: true })
  }
  return { asOf, chosen, setAsOf }
}

export function usePnlReport(month: string): Report<PnlView> {
  const months = usePnlMonths()
  const payments = usePaymentStats(month)
  const lines = useCategoryLines(month)
  const via = useViaStat(month)
  const view = useMemo(
    () => (months.data && payments.data && lines.data && via.data ? buildPnl(month, months.data[month] ?? null, payments.data, lines.data, via.data) : null),
    [months.data, payments.data, lines.data, via.data, month],
  )
  const all = [months, payments, lines, via]
  return { view, isPending: all.some(q => q.isPending), isError: all.some(q => q.isError), refetch: () => all.forEach(q => void q.refetch()) }
}

export function useCategoryReport(month: string): Report<CategoryView> {
  const lines = useCategoryLines(month)
  const via = useViaStat(month)
  const view = useMemo(() => (lines.data && via.data ? buildCategories(lines.data, via.data) : null), [lines.data, via.data])
  return {
    view,
    isPending: lines.isPending || via.isPending,
    isError: lines.isError || via.isError,
    refetch: () => {
      void lines.refetch()
      void via.refetch()
    },
  }
}

export function useAgingReport(asOf: string): Report<AgingView> {
  const q = useAging(asOf)
  const view = useMemo(() => (q.data ? buildAging(asOf, q.data.rows, q.data.advances) : null), [q.data, asOf])
  return { view, isPending: q.isPending, isError: q.isError, refetch: () => void q.refetch() }
}

export function useOweReport(asOf: string): Report<PayablesView> {
  const q = usePayables(asOf)
  const view = useMemo(() => (q.data ? buildPayables(asOf, q.data) : null), [q.data, asOf])
  return { view, isPending: q.isPending, isError: q.isError, refetch: () => void q.refetch() }
}

export function useGstReport(month: string): Report<GstView> {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const q = useGstMonths()
  const view = useMemo(() => (q.data ? buildGst(month, q.data, isAdmin) : null), [q.data, month, isAdmin])
  return { view, isPending: q.isPending, isError: q.isError, refetch: () => void q.refetch() }
}

export function useTeamReport(month: string, today: string): Report<TeamView> {
  const team = useTeamMonth(month)
  const payments = usePaymentStats(month)
  const view = useMemo(
    () => (team.data && payments.data ? buildTeam(month, today, team.data.credited, team.data.staff, payments.data.unresolved) : null),
    [team.data, payments.data, month, today],
  )
  return {
    view,
    isPending: team.isPending || payments.isPending,
    isError: team.isError || payments.isError,
    refetch: () => {
      void team.refetch()
      void payments.refetch()
    },
  }
}
