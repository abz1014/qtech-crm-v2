import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { businessToday } from '@/lib/dates'
import { invalidateAfter } from '@/features/invalidation'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/today/api'
import { buildToday } from '@/features/today/rules'
import type { Role, TodayView } from '@/features/today/types'

/* Today hooks (R11): one per read, one per write. Server data stays in the TanStack cache; nothing is copied into state. */

/** Today's date in the business timezone, re-read every minute so a tab left open across midnight turns the page over. */
export function useBusinessToday(): string {
  const [today, setToday] = useState(businessToday)
  useEffect(() => {
    const id = window.setInterval(() => setToday(businessToday()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  return today
}

/**
 * The Today read, as one query: the page, the top bar's counts and Money's tab counts share it, and the app's start reads it
 * ahead of the page (prefetchToday).
 */
export function todayQuery(user: { id: string; role: Role }, today: string) {
  // The date is part of the work (snoozes read it), but not of the key: the key is the cache slot, the date is re-read on refresh.
  return { queryKey: qk.today.board(), queryFn: () => api.loadTodayData(user, today) }
}

/**
 * Read just now (by the app's start, or by a page the extras waited for): a mount does not read it all again. A read a save has
 * made out of date (invalidated) is read again on mount, as always.
 */
const JUST_READ_MS = 10_000
export const unlessJustRead = (query: { state: { dataUpdatedAt: number; isInvalidated: boolean } }): boolean | 'always' =>
  !query.state.isInvalidated && Date.now() - query.state.dataUpdatedAt < JUST_READ_MS ? false : 'always'

/** Start the Today read before the page is drawn (routeChunks.ts). The page's mount then finds it and does not read it again. */
export function prefetchToday(client: QueryClient, user: { id: string; role: Role }): Promise<void> {
  return client.prefetchQuery(todayQuery(user, businessToday()))
}

/**
 * `refetchOnMount`: every mount reads Today fresh ('always'), except right after the same data was read, which is the app's
 * own start reading it ahead of the page (or the page itself, for the counts that wait for it).
 */
export function useTodayData(user: { id: string; role: Role }, today: string, enabled = true) {
  const client = useQueryClient()
  const query = useQuery({ ...todayQuery(user, today), refetchOnMount: unlessJustRead, enabled })
  // The key has no date, so a tab left open across midnight would keep yesterday's reads (the server's overdue flags, the
  // month-end item, the quarter). When the business date turns over, read everything on Today again. After useQuery, so
  // the refetch runs with the new date.
  const shownFor = useRef(today)
  useEffect(() => {
    if (shownFor.current === today) return
    shownFor.current = today
    void client.invalidateQueries({ queryKey: qk.today.all })
  }, [client, today])
  return query
}

/** The Today list for this person on this day: every rule, snoozes subtracted, grouped. Null until the data has loaded. */
export function useTodayView(
  user: { id: string; role: Role },
  today: string,
  enabled = true,
): { view: TodayView | null; data: api.TodayData | undefined; query: ReturnType<typeof useTodayData> } {
  const query = useTodayData(user, today, enabled)
  const data = query.data
  const view = useMemo(() => {
    if (!data) return null
    return buildToday({
      today,
      user,
      roleOf: id => (id ? (data.roles[id] ?? null) : null),
      rfqs: data.rfqs,
      clarifications: data.clarifications,
      inquiries: data.inquiries,
      legs: data.legs,
      orders: data.orders,
      receivables: data.receivables,
      monthEnd: data.monthEnd,
      costs: data.costs,
      invoices: data.invoices,
      recurring: data.recurring,
      jobs: data.jobs,
      snoozes: data.snoozes,
    })
    // user is a fresh object each render in the caller; its id and role are what matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, today, user.id, user.role])
  return { view, data, query }
}

/** my_target_progress(): the caller's own row. Every active role may call it. */
export function useMyTarget() {
  return useQuery({ queryKey: qk.today.target(), queryFn: api.getMyTarget, refetchOnMount: 'always' })
}

export function useLegDraft(legId: string | undefined) {
  return useQuery({ queryKey: qk.today.leg(legId ?? ''), queryFn: () => api.getLegDraft(legId as string), enabled: Boolean(legId) })
}

/** Admin and sales only: the caller passes `enabled` false for an engineer, so the request is never made. */
export function usePaymentDraft(orderId: string | undefined, enabled: boolean) {
  return useQuery({ queryKey: qk.today.payment(orderId ?? ''), queryFn: () => api.getPaymentDraft(orderId as string), enabled: enabled && Boolean(orderId), refetchOnMount: 'always' })
}

export function useSnooze() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { rule: string; subjectId: string; untilOn: string }) => api.snoozeItem(v),
    onSuccess: () => invalidateAfter(client, 'today.snooze', {}),
  })
}

export function useUnsnooze() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { rule: string; subjectId: string; previousUntilOn?: string | null }) => api.unsnoozeItem(v),
    onSuccess: () => invalidateAfter(client, 'today.snooze', {}),
  })
}

/** What a chase tap records, so the stamp can be made and, inside 10 seconds, taken back exactly. */
export type ChaseSpec =
  | { kind: 'customer'; ids: string[] }
  | { kind: 'supplier'; inquiryId: string; before: { lastChasedOn: string | null; lastChasedBy?: string | null; chaseCount: number } }
  | { kind: 'goods'; legId: string; before: { lastChasedOn: string | null; lastChasedBy?: string | null; chaseCount: number } }
  | { kind: 'payment'; invoiceIds: string[]; before: Array<{ id: string; lastRemindedOn: string | null; reminderCount: number }> }

export interface ChaseResult {
  /** The new count (asks, chases, reminders). */
  count: number
  undo: () => Promise<void>
}

/** Make the stamp (the text is already on the clipboard) and hand back how to take it back. Nothing is refreshed here: the caller refreshes when the undo window closes. */
export async function performChase(spec: ChaseSpec): Promise<ChaseResult> {
  switch (spec.kind) {
    case 'customer': {
      const before = await api.readClarificationsBefore(spec.ids)
      await api.stampCustomerChase(spec.ids)
      return { count: Math.max(0, ...before.map(b => b.askCount)) + 1, undo: () => api.undoCustomerChase(before) }
    }
    // Each "before" is read at the tap (like the customer's): the facts on screen may predate a colleague's chase, and an
    // Undo that restored them would wipe that chase out.
    case 'supplier': {
      const before = (await api.readSupplierChaseBefore(spec.inquiryId)) ?? spec.before
      const count = await api.stampSupplierChaseOnToday(spec.inquiryId)
      return { count, undo: () => api.undoSupplierChase(spec.inquiryId, before) }
    }
    case 'goods': {
      const before = (await api.readGoodsChaseBefore(spec.legId)) ?? spec.before
      const count = await api.stampGoodsChase(spec.legId)
      return { count, undo: () => api.undoGoodsChase(spec.legId, before) }
    }
    case 'payment': {
      const read = await api.readPaymentRemindersBefore(spec.invoiceIds)
      const before = read.length > 0 ? read : spec.before
      await api.stampPaymentReminder(spec.invoiceIds)
      return { count: Math.max(0, ...before.map(b => b.reminderCount)) + 1, undo: () => api.undoPaymentReminder(before) }
    }
  }
}

export function useRefreshAfterChase() {
  const client = useQueryClient()
  return () => invalidateAfter(client, 'today.chase', {}, { wait: 'all' })
}
