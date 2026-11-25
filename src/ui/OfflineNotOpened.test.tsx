import { useRef, useState } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectionContext, type Connection } from '@/lib/connection'
import { NOT_OPENED_TEXT, OFFLINE_NOTICE_MS, OfflineSkeletonNotice } from '@/ui/OfflineNotOpened'
import { Skeleton } from '@/ui/Skeleton'

afterEach(() => vi.useRealTimers())

let draw: () => void = () => {}
function Shell({ connection, loading = true }: { connection: Connection; loading?: boolean }) {
  const main = useRef<HTMLElement>(null)
  const [busy, setBusy] = useState(loading)
  draw = () => setBusy(false)
  return (
    <ConnectionContext.Provider value={connection}>
      <main ref={main} data-testid="main">
        <OfflineSkeletonNotice root={main} />
        {busy ? <Skeleton className="h-4" /> : <p>Lock a month</p>}
      </main>
    </ConnectionContext.Provider>
  )
}

describe('OfflineSkeletonNotice (review 24 Nov, screen 11)', () => {
  it('offline, placeholders that stay get the sentence above them and stop pulsing', () => {
    vi.useFakeTimers()
    render(<Shell connection="offline" />)
    expect(screen.queryByText(NOT_OPENED_TEXT)).toBeNull()
    act(() => void vi.advanceTimersByTime(OFFLINE_NOTICE_MS))
    expect(screen.getByText(NOT_OPENED_TEXT)).toBeInTheDocument()
    expect(screen.getByText(NOT_OPENED_TEXT).closest('[aria-live="polite"]')).not.toBeNull()
    expect(screen.getByTestId('main')).toHaveAttribute('data-offline-waiting')
  })

  it('goes as soon as the page draws', async () => {
    vi.useFakeTimers()
    render(<Shell connection="offline" />)
    act(() => void vi.advanceTimersByTime(OFFLINE_NOTICE_MS))
    expect(screen.getByText(NOT_OPENED_TEXT)).toBeInTheDocument()
    act(() => draw())
    // the MutationObserver reports on a microtask
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByText(NOT_OPENED_TEXT)).toBeNull()
    expect(screen.getByTestId('main')).not.toHaveAttribute('data-offline-waiting')
  })

  it('says nothing online, or offline when the page has what it needs', () => {
    vi.useFakeTimers()
    const { unmount } = render(<Shell connection="online" />)
    act(() => void vi.advanceTimersByTime(OFFLINE_NOTICE_MS * 3))
    expect(screen.queryByText(NOT_OPENED_TEXT)).toBeNull()
    unmount()
    render(<Shell connection="offline" loading={false} />)
    act(() => void vi.advanceTimersByTime(OFFLINE_NOTICE_MS * 3))
    expect(screen.queryByText(NOT_OPENED_TEXT)).toBeNull()
  })
})
