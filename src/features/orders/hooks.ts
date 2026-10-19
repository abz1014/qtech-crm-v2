import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { invalidateAfter } from '@/features/invalidation'
import * as api from '@/features/orders/api'
import type { LegPatch } from '@/features/orders/lib/legModel'

/*
 * Order hooks (O01, O03): one hook per read, one per write; keys from the factory, refreshes named in the invalidation map.
 * `money` is false for an engineer: the price columns and the money part of v_order_state are then never requested.
 */

export function useOrderHeader(id: string | undefined, money: boolean) {
  return useQuery({ queryKey: qk.orders.part(id ?? '', 'header'), queryFn: () => api.getOrderHeader(id as string, money), enabled: Boolean(id) })
}

export function useOrderItems(id: string | undefined, money: boolean) {
  return useQuery({ queryKey: qk.orders.part(id ?? '', 'items'), queryFn: () => api.listOrderItems(id as string, money), enabled: Boolean(id) })
}

/** Legs need the items (which lines sit on which leg), so they wait for them. */
export function useOrderLegs(id: string | undefined, items: readonly api.OrderItemRow[] | undefined) {
  return useQuery({
    queryKey: qk.orders.part(id ?? '', 'legs'),
    queryFn: () => api.listOrderLegs(id as string, items as readonly api.OrderItemRow[]),
    enabled: Boolean(id) && items !== undefined,
  })
}

export function useOrderEngineers(id: string | undefined) {
  return useQuery({ queryKey: qk.orders.part(id ?? '', 'engineers'), queryFn: () => api.listOrderEngineers(id as string), enabled: Boolean(id) })
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
  return useQuery({ queryKey: qk.orders.part(id ?? '', 'money'), queryFn: () => api.getOrderMoney(id as string, role as 'admin' | 'sales'), enabled: Boolean(id) && role !== null })
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

/** The top-bar Orders count. */
export function useActiveOrderCount() {
  return useQuery({ queryKey: qk.orders.activeCount(), queryFn: api.countActiveOrders, staleTime: 60_000 })
}

/** O04: the orders list. `role` is in the key because the request itself differs by role. */
export function useOrdersList(role: 'admin' | 'sales' | 'engineer' | null) {
  return useQuery({ queryKey: qk.orders.board(role ?? ''), queryFn: () => api.listOrders(role as 'admin' | 'sales' | 'engineer'), enabled: role !== null })
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
  return useQuery({ queryKey: qk.orders.ranked(rfqId ?? '', role), queryFn: () => api.listRankedQuotes(rfqId as string), enabled: enabled && Boolean(rfqId), staleTime: 30_000 })
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
