import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidateAfter } from '@/features/invalidation'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/settings/productCategories/api'

export function useProductCategories(enabled = true) {
  return useQuery({ queryKey: qk.settings.productCategories(), queryFn: api.listProductCategories, enabled })
}

export function useRenameProductCategory() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; name: string }) => api.renameProductCategory(v.id, v.name),
    onSuccess: () => invalidateAfter(client, 'productCategory.edit', {}),
  })
}

export function useSetProductCategoryCurated() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; curated: boolean }) => api.setProductCategoryCurated(v.id, v.curated),
    onSuccess: () => invalidateAfter(client, 'productCategory.edit', {}),
  })
}

export function useMergeProductCategories() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { keep: string; drop: string }) => api.mergeProductCategories(v.keep, v.drop),
    onSuccess: () => invalidateAfter(client, 'productCategory.merge', {}),
  })
}

/** The fill: each batch of 200 is one write; the screens that show an item's category refresh once at the end (see FillDialog). */
export function useApplyFillBatch() {
  return useMutation({ mutationFn: (batch: Parameters<typeof api.applyFillBatch>[0]) => api.applyFillBatch(batch) })
}

export function useRefreshAfterFill() {
  const client = useQueryClient()
  return () => invalidateAfter(client, 'productCategory.fill', {})
}
