import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { useLeaveGuard } from '@/features/rfqs/useLeaveGuard'

function Guarded({ when, onBlocked }: { when: boolean; onBlocked: (proceed: () => void) => void }) {
  useLeaveGuard(when, onBlocked)
  return null
}

const marked = () => (window.history.state as Record<string, unknown> | null)?.__qtechLeave === true

describe('useLeaveGuard: the Back button (HW-49)', () => {
  it('Back asks first and stays; proceed goes back for real', async () => {
    window.history.pushState({ before: 1 }, '')
    const asked = vi.fn<(proceed: () => void) => void>()
    render(
      <MemoryRouter>
        <Guarded when onBlocked={asked} />
      </MemoryRouter>,
    )
    expect(marked()).toBe(true)
    window.history.back()
    await waitFor(() => expect(asked).toHaveBeenCalledTimes(1))
    expect(marked()).toBe(true) // the entry is back: a second Back asks again
    asked.mock.calls[0][0]()
    await waitFor(() => expect((window.history.state as Record<string, unknown> | null)?.before).toBe(1))
  })

  it('adds nothing while there is nothing to protect, and takes its entry off when that changes', async () => {
    window.history.pushState({ clean: 1 }, '')
    const { rerender } = render(
      <MemoryRouter>
        <Guarded when={false} onBlocked={() => {}} />
      </MemoryRouter>,
    )
    expect(marked()).toBe(false)
    rerender(
      <MemoryRouter>
        <Guarded when onBlocked={() => {}} />
      </MemoryRouter>,
    )
    expect(marked()).toBe(true)
    rerender(
      <MemoryRouter>
        <Guarded when={false} onBlocked={() => {}} />
      </MemoryRouter>,
    )
    await waitFor(() => expect((window.history.state as Record<string, unknown> | null)?.clean).toBe(1))
  })
})
