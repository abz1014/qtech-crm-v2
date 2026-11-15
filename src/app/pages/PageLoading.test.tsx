import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageLoading } from '@/app/pages/PageLoading'
import { SLOW_LOAD_MS, SLOW_LOAD_TEXT } from '@/lib/useSlowLoad'

afterEach(() => vi.useRealTimers())

describe('PageLoading: the route fallback while a page downloads', () => {
  it('is a named, page-shaped placeholder, never a blank page; it says when it is slow', () => {
    vi.useFakeTimers()
    render(<PageLoading />)
    const status = screen.getByRole('status', { name: 'Loading the page' })
    expect(status.querySelectorAll('.skeleton').length).toBeGreaterThanOrEqual(4)
    expect(status.textContent).not.toContain(SLOW_LOAD_TEXT)
    act(() => void vi.advanceTimersByTime(SLOW_LOAD_MS))
    expect(status.textContent).toContain(SLOW_LOAD_TEXT)
  })
})
