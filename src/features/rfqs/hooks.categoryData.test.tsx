import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getCategoryEvidence: vi.fn(),
  getManualTags: vi.fn(),
  getRecentAsks: vi.fn(),
}))
vi.mock('@/features/rfqs/api', () => api)

import { useSupplierCategoryData } from '@/features/rfqs/hooks'

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useSupplierCategoryData', () => {
  it('one rejected read keeps the others and sets partial', async () => {
    api.getCategoryEvidence.mockResolvedValue([{ supplier_id: 's1', family_id: 'f1' }])
    api.getManualTags.mockRejectedValue(new Error('boom'))
    api.getRecentAsks.mockResolvedValue({ s1: ['other'] })
    const { result } = renderHook(() => useSupplierCategoryData(['f1'], ['s1'], '2026-11-01', true), { wrapper: wrap() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toMatchObject({ partial: true, manualTags: undefined, evidence: [{ supplier_id: 's1', family_id: 'f1' }], recentAsks: { s1: ['other'] } })
  })

  it('is not partial when every read loads', async () => {
    api.getCategoryEvidence.mockResolvedValue([])
    api.getManualTags.mockResolvedValue([])
    api.getRecentAsks.mockResolvedValue({})
    const { result } = renderHook(() => useSupplierCategoryData(['f2'], ['s2'], '2026-11-01', true), { wrapper: wrap() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.partial).toBe(false)
  })
})
