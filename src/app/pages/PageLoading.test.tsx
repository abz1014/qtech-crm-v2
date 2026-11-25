import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageLoading } from '@/app/pages/PageLoading'
import { ConnectionContext } from '@/lib/connection'
import { SLOW_LOAD_MS, SLOW_LOAD_TEXT } from '@/lib/useSlowLoad'
import { NOT_OPENED_TEXT, OFFLINE_GRACE_MS } from '@/ui/OfflineNotOpened'

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
    expect(status.textContent).not.toContain(NOT_OPENED_TEXT)
  })

  it('offline, a page this device never downloaded says so instead of pulsing for good (review 24 Nov, screen 11)', () => {
    vi.useFakeTimers()
    render(
      <ConnectionContext.Provider value="offline">
        <PageLoading />
      </ConnectionContext.Provider>,
    )
    // a page the device kept still arrives in a moment: the placeholders show first
    expect(screen.getByRole('status', { name: 'Loading the page' }).querySelectorAll('.skeleton').length).toBeGreaterThan(0)
    act(() => void vi.advanceTimersByTime(OFFLINE_GRACE_MS))
    const status = screen.getByRole('status', { name: 'This page is not on this device' })
    expect(status).toHaveTextContent(NOT_OPENED_TEXT)
    expect(status.querySelector('.skeleton')).toBeNull()
    expect(NOT_OPENED_TEXT).not.toMatch(/;|enquiry/i)
  })
})
