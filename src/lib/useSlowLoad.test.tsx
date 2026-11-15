import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SLOW_LOAD_MS, useSlowLoad } from '@/lib/useSlowLoad'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useSlowLoad (audit 1 major 5)', () => {
  it('turns true only after the load has taken SLOW_LOAD_MS, and false the moment it ends', () => {
    const { result, rerender } = renderHook(({ loading }) => useSlowLoad(loading), { initialProps: { loading: true } })
    expect(result.current).toBe(false)
    act(() => void vi.advanceTimersByTime(SLOW_LOAD_MS - 1))
    expect(result.current).toBe(false)
    act(() => void vi.advanceTimersByTime(1))
    expect(result.current).toBe(true)
    rerender({ loading: false })
    expect(result.current).toBe(false)
  })

  it('a quick load never reads as slow', () => {
    const { result, rerender } = renderHook(({ loading }) => useSlowLoad(loading), { initialProps: { loading: true } })
    act(() => void vi.advanceTimersByTime(800))
    rerender({ loading: false })
    act(() => void vi.advanceTimersByTime(SLOW_LOAD_MS))
    expect(result.current).toBe(false)
  })
})
