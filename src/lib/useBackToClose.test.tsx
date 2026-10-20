import { StrictMode, useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackToClose } from '@/lib/useBackToClose'

/*
 * The hook on its own, with a plain open/close state standing in for a sheet (no Radix, no gallery): what matters is the
 * history it leaves behind. jsdom runs history.back() asynchronously and fires popstate, as a browser does.
 */
const sheets = () => ((window.history.state as { __qtechSheets?: string[] } | null)?.__qtechSheets ?? []).length

function Sheet({ name, onBack, refuse = false, children }: { name: string; onBack?: () => void; refuse?: boolean; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  useBackToClose(open, () => {
    onBack?.()
    if (!refuse) setOpen(false)
  })
  return (
    <div>
      <button onClick={() => setOpen(true)}>{`open ${name}`}</button>
      {open ? (
        <div role="dialog" aria-label={name}>
          <button onClick={() => setOpen(false)}>{`cancel ${name}`}</button>
          {children}
        </div>
      ) : null}
    </div>
  )
}

const back = () => act(async () => window.history.back())

beforeEach(async () => {
  // Start every test on a clean entry of its own.
  window.history.replaceState({ usr: null, key: 'start', idx: 0 }, '', '/today')
})

describe('useBackToClose', () => {
  it('opening adds one history entry on the same URL that keeps the router state; Back closes the sheet and the page stays', async () => {
    const onBack = vi.fn()
    render(<Sheet name="Record payment" onBack={onBack} />)
    const before = window.history.length
    await userEvent.click(screen.getByText('open Record payment'))
    expect(window.history.length).toBe(before + 1)
    expect(window.location.pathname).toBe('/today')
    expect(window.history.state).toMatchObject({ key: 'start', idx: 0 })
    expect(sheets()).toBe(1)

    await back()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(window.location.pathname).toBe('/today')
    expect(sheets()).toBe(0)
  })

  it('closing another way takes the entry back off, so the next Back is not swallowed', async () => {
    render(<Sheet name="Expense" />)
    await userEvent.click(screen.getByText('open Expense'))
    expect(sheets()).toBe(1)
    await userEvent.click(screen.getByText('cancel Expense'))
    await waitFor(() => expect(sheets()).toBe(0))
    expect(window.history.state).toMatchObject({ key: 'start' })
  })

  it('nested sheets: Back closes only the top one', async () => {
    render(
      <Sheet name="Order">
        <Sheet name="Confirm" />
      </Sheet>,
    )
    await userEvent.click(screen.getByText('open Order'))
    await userEvent.click(screen.getByText('open Confirm'))
    expect(sheets()).toBe(2)
    await back()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Confirm' })).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Order' })).toBeInTheDocument()
    expect(sheets()).toBe(1)
    await back()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Order' })).toBeNull())
    expect(sheets()).toBe(0)
  })

  it('a sheet that refuses to close (a save in flight) gets its entry back', async () => {
    const onBack = vi.fn()
    render(<Sheet name="Busy" refuse onBack={onBack} />)
    await userEvent.click(screen.getByText('open Busy'))
    await back()
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('dialog', { name: 'Busy' })).toBeInTheDocument()
    await waitFor(() => expect(sheets()).toBe(1))
  })

  it('closed by a navigation (a link inside, or Save then navigate): the entry under the new page is left alone', async () => {
    const go = vi.spyOn(window.history, 'go')
    function NavSheet() {
      const [open, setOpen] = useState(true)
      useBackToClose(open, () => setOpen(false))
      return open ? (
        <button
          onClick={() => {
            setOpen(false)
            window.history.pushState({ usr: null, key: 'next', idx: 1 }, '', '/orders/1')
          }}
        >
          save and open
        </button>
      ) : null
    }
    render(<NavSheet />)
    await userEvent.click(screen.getByText('save and open'))
    await act(async () => {})
    expect(go).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/orders/1')
    go.mockRestore()
  })

  it('StrictMode (mount, unmount, mount) leaves exactly one entry', async () => {
    const before = window.history.length
    render(
      <StrictMode>
        <Sheet name="Strict" />
      </StrictMode>,
    )
    await userEvent.click(screen.getByText('open Strict'))
    await act(async () => {})
    expect(window.history.length).toBe(before + 1)
    expect(sheets()).toBe(1)
  })

  it('does nothing while disabled', async () => {
    function Off() {
      useBackToClose(true, () => {}, { enabled: false })
      return null
    }
    const before = window.history.length
    render(<Off />)
    expect(window.history.length).toBe(before)
    expect(sheets()).toBe(0)
  })
})
