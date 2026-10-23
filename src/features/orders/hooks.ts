import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { nullOnInvalidId } from '@/lib/uuid'
import { seesPrices } from '@/app/session'
import { invalidateAfter } from '@/features/invalidation'
import * as api from '@/features/orders/api'
import type { LegPatch } from '@/features/orders/lib/legModel'

/*
 * Order hooks (O01, O03): one hook per read, one per write; keys from the factory, refreshes named in the invalidation map.
 * `money` is false for an engineer: the price columns and the money part of v_order_state are then never requested.
 */

/** The order page's first reads (its hooks, and the app's start reading them ahead of the page: orders/prefetch.ts). */
export const orderHeaderQuery = (id: string, money: boolean) => ({ queryKey: qk.orders.part(id, 'header'), queryFn: () => api.getOrderHeader(id, money).catch(nullOnInvalidId) })
export const orderItemsQuery = (id: string, money: boolean) => ({ queryKey: qk.orders.part(id, 'items'), queryFn: () => api.listOrderItems(id, money) })
export const orderLegsQuery = (id: string) => ({ queryKey: qk.orders.part(id, 'legs'), queryFn: () => api.fetchOrderLegs(id) })
export const orderEngineersQuery = (id: string) => ({ queryKey: qk.orders.part(id, 'engineers'), queryFn: () => api.listOrderEngineers(id) })
export const orderMoneyQuery = (id: string, role: 'admin' | 'sales') => ({ queryKey: qk.orders.part(id, 'money'), queryFn: () => api.getOrderMoney(id, role) })
export const ordersListQuery = (role: 'admin' | 'sales' | 'engineer' | null) => ({
  queryKey: qk.orders.board(role ?? ''),
  queryFn: () => api.listOrders(role as 'admin' | 'sales' | 'engineer'),
})

export function useOrderHeader(id: string | undefined, money: boolean) {
  return useQuery({ ...orderHeaderQuery(id ?? '', money), enabled: Boolean(id) })
}

export function useOrderItems(id: string | undefined, money: boolean) {
  return useQuery({ ...orderItemsQuery(id ?? '', money), enabled: Boolean(id) })
}

/**
 * Legs need the items (which lines sit on which leg) for their order and lead times, so they wait for them. The items are applied in
 * `select`, not in the fetch: a write refreshes items and legs together, and a fetch would otherwise order the legs against the items
 * from before the write and keep that until the next refresh.
 */
export function useOrderLegs(id: string | undefined, items: readonly api.OrderItemRow[] | undefined) {
  const select = useCallback((raw: api.OrderLegsRaw) => api.shapeOrderLegs(raw, items ?? []), [items])
  return useQuery({
    ...orderLegsQuery(id ?? ''),
    select,
    enabled: Boolean(id) && items !== undefined,
  })
}

export function useOrderEngineers(id: string | undefined) {
  return useQuery({ ...orderEngineersQuery(id ?? ''), enabled: Boolean(id) })
}

export function useEngineerCandidates(enabled: boolean) {
  return useQuery({ queryKey: qk.orders.engineers(), queryFn: api.listEngineerCandidates, enabled, staleTime: 60_000 })
}

export function useOrdersForRfq(rfqId: string | undefined) {
  return useQuery({ queryKey: qk.orders.forRfq(rfqId ?? ''), queryFn: () => api.listOrdersForRfq(rfqId as string), enabled: Boolean(rfqId) })
}

export function useLastTerms(companyId: string | undefined, enabled: boolean) {
  return useQuery({ queryKey: qk.orders.lastTerms(companyId ?? ''), queryFn: () => api.getLastTerms(companyId as string), enabled: enabled && Boolean(companyId), staleTime: 0, gcTime: 0 })
}

/** One confirm creates the order. The id is made by the caller and kept for a retry, so a double submit creates one order. */
export function useConvertRfq(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: api.ConvertInput) => api.convertRfqToOrder(input),
    onSuccess: () => invalidateAfter(client, 'order.convert', { rfqId }),
  })
}

/** The number and customer PO of the order that already won this RFQ (HW-56). */
export function useOrderBrief(orderId: string | null) {
  return useQuery({ queryKey: ['order-brief', orderId ?? ''], queryFn: () => api.getOrderBrief(orderId as string), enabled: orderId !== null, staleTime: 0 })
}

export function useUpdateOrder(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (patch: Parameters<typeof api.updateOrder>[1]) => api.updateOrder(orderId, patch),
    onSuccess: () => invalidateAfter(client, 'order.update', { orderId }),
  })
}

/** Cancel, or take a cancel back (patch with cancelled_on null). */
export function useCancelOrder(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (patch: Parameters<typeof api.updateOrder>[1]) => api.updateOrder(orderId, patch),
    onSuccess: () => invalidateAfter(client, 'order.cancel', { orderId }),
  })
}

export function useUpdateItem(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; patch: Parameters<typeof api.updateItem>[1] }) => api.updateItem(v.id, v.patch),
    onSuccess: () => invalidateAfter(client, 'order.update', { orderId }),
  })
}

export function useSetItemRates(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (rates: ReadonlyArray<{ id: string; gstRate: number }>) => api.setItemRates(rates),
    onSuccess: () => invalidateAfter(client, 'order.update', { orderId }),
  })
}

export function useUpdateLeg(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; patch: LegPatch & { reference?: string | null } }) => api.updateLeg(v.id, v.patch),
    onSuccess: () => invalidateAfter(client, 'order.update', { orderId }),
  })
}

export function useAddEngineer(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => api.addOrderEngineer(orderId, userId),
    onSuccess: () => invalidateAfter(client, 'order.update', { orderId }),
  })
}

export function useRemoveEngineer(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => api.removeOrderEngineer(orderId, userId),
    onSuccess: () => invalidateAfter(client, 'order.update', { orderId }),
  })
}

export function useMyJobTitle(userId: string | undefined) {
  return useQuery({ queryKey: qk.orders.jobTitle(userId ?? ''), queryFn: () => api.getMyJobTitle(userId as string), enabled: Boolean(userId), staleTime: 300_000 })
}

/** Admin and sales only: the caller passes a role only for them, so an engineer never makes this request. */
export function useOrderMoney(id: string | undefined, role: 'admin' | 'sales' | null) {
  return useQuery({ ...orderMoneyQuery(id ?? '', role as 'admin' | 'sales'), enabled: Boolean(id) && role !== null })
}

export function useLegPos(id: string | undefined, legIds: readonly string[], money = false) {
  return useQuery({ queryKey: qk.orders.part(id ?? '', 'pos'), queryFn: () => api.listLegPos(legIds, money), enabled: Boolean(id) && legIds.length > 0 })
}

export function useAddItem(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (l: api.NewLine) => api.addOrderItem(l),
    onSuccess: () => invalidateAfter(client, 'order.update', { orderId }),
  })
}

export function useNextOrderNumber(enabled: boolean) {
  return useQuery({ queryKey: qk.orders.nextNumber(), queryFn: api.getNextOrderNumber, enabled, staleTime: 0, gcTime: 0 })
}

export function useSupplierMedianDays(supplierId: string | undefined) {
  return useQuery({ queryKey: qk.orders.supplierMedian(supplierId ?? ''), queryFn: () => api.getSupplierMedianDays(supplierId as string), enabled: Boolean(supplierId), staleTime: 300_000 })
}

export function useAddLeg(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; supplierId: string; currency: string }) => api.addOrderLeg({ ...v, orderId }),
    onSuccess: () => invalidateAfter(client, 'order.update', { orderId }),
  })
}

export function useResolveBasis(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (basis: 'net' | 'gross') => api.resolveValueBasis(orderId, basis),
    onSuccess: () => invalidateAfter(client, 'order.update', { orderId }),
  })
}

export function useSupplierChoices(enabled: boolean) {
  return useQuery({ queryKey: qk.orders.supplierChoices(), queryFn: api.listSupplierChoices, enabled, staleTime: 60_000 })
}

/** O04: the orders list. `role` is in the key because the request itself differs by role. */
export function useOrdersList(role: 'admin' | 'sales' | 'engineer' | null) {
  return useQuery({ ...ordersListQuery(role), enabled: role !== null })
}

/** O02: past orders matching what is typed (nothing typed: the most recent). Read only while the dialog is open. */
export function usePastOrders(text: string, enabled: boolean) {
  return useQuery({ queryKey: qk.orders.past(text), queryFn: ({ signal }) => api.searchPastOrders(text, signal), enabled, staleTime: 0 })
}

/** One confirm creates the order from a past one. The id is made by the caller and kept for a retry, so a double submit makes one order. */
export function useCreateRepeatOrder() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: api.RepeatInput & { companyId: string }) => api.createRepeatOrder(input),
    onSuccess: (_id, v) => invalidateAfter(client, 'order.repeat', { companyId: v.companyId }),
  })
}

export function usePastOrder(id: string | undefined) {
  return useQuery({ queryKey: qk.orders.pastOne(id ?? ''), queryFn: () => api.getPastOrder(id as string), enabled: Boolean(id) })
}

/** A8: the ranked quotes of an RFQ. `role` is in the key because the answer differs by role (an engineer's has no selling price or spread). */
export function useRankedQuotes(rfqId: string | undefined, role: string, enabled = true) {
  // Never for an engineer: the ranking carries supplier prices (owner decision 2026-10-22).
  return useQuery({ queryKey: qk.orders.ranked(rfqId ?? '', role), queryFn: () => api.listRankedQuotes(rfqId as string), enabled: enabled && Boolean(rfqId) && seesPrices(role), staleTime: 30_000 })
}

/** A8 (O09): split a line by quantity onto another or a new leg. */
export function useSplitOrderItem(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: api.SplitInput) => api.splitOrderItem(input),
    onSuccess: () => invalidateAfter(client, 'order.update', { orderId }),
  })
}

/** A8 (O09): one selling price for all parts of a split item. */
export function useSetGroupPrice(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { ids: readonly string[]; unitPriceNet: number }) => api.setGroupPrice(v.ids, v.unitPriceNet),
    onSuccess: () => invalidateAfter(client, 'order.update', { orderId }),
  })
}
