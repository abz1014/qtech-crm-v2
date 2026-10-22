import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useInFlight } from './useInFlight'

describe('useInFlight', () => {
  it('drops a second run while the first is in flight, then allows the next', async () => {
    const { result } = renderHook(() => useInFlight())
    let calls = 0
    let finish: () => void = () => undefined
    const slow = () =>
      new Promise<void>(resolve => {
        calls++
        finish = resolve
      })
    const first = result.current(slow)
    const second = result.current(slow)
    expect(await second).toBeUndefined()
    finish()
    await first
    expect(calls).toBe(1)
    const third = result.current(slow)
    finish()
    await third
    expect(calls).toBe(2)
  })

  it('releases after a failure', async () => {
    const { result } = renderHook(() => useInFlight())
    await expect(result.current(() => Promise.reject(new Error('x')))).rejects.toThrow('x')
    expect(await result.current(() => Promise.resolve(5))).toBe(5)
  })
})
