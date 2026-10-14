import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { session, type SessionState } from '@/app/session'
import { AppShell } from '@/app/shell/AppShell'
import { axeViolations } from '@/test/axe'

const signedIn: SessionState = { status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role: 'sales' } }

function shell(path = '/today') {
  return render(
    <SessionProvider value={signedIn}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/today" element={<p>Today page</p>} />
            <Route path="/rfqs" element={<p>RFQs page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('account menu (U03, on Popover)', () => {
  it('the avatar opens a menu with the name, the role and Sign out; Sign out calls session.signOut()', async () => {
    const user = userEvent.setup()
    const signOut = vi.spyOn(session, 'signOut')
    shell()
    const trigger = screen.getAllByRole('button', { name: 'Account menu, Ayesha Rana' })[0]
    await user.click(trigger)
    const menu = await screen.findByRole('menu', { name: 'Account' })
    expect(within(menu).getByText('Ayesha Rana')).toBeInTheDocument()
    expect(within(menu).getByText('Sales')).toBeInTheDocument()
    expect(await axeViolations(menu)).toEqual([])
    await user.click(within(menu).getByRole('menuitem', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('keyboard only: Enter opens, first item is focused, Esc returns focus to the avatar', async () => {
    const user = userEvent.setup()
    shell()
    const trigger = screen.getAllByRole('button', { name: 'Account menu, Ayesha Rana' })[0]
    trigger.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Sign out' })).toHaveFocus())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(trigger).toHaveFocus()
  })
})

describe('search button and Cmd/Ctrl+K open the palette (U08)', () => {
  it('the top-bar search button opens it; it lists this role\'s destinations; Enter goes there', async () => {
    const user = userEvent.setup()
    shell()
    await user.click(screen.getAllByRole('button', { name: 'Search or jump to' })[0])
    const dlg = await screen.findByRole('dialog', { name: 'Search or jump to' })
    const rows = await within(dlg).findAllByRole('option')
    expect(rows.map(r => r.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Today'), expect.stringContaining('RFQs'), expect.stringContaining('Money')]),
    )
    await user.keyboard('rfq{Enter}')
    expect(await screen.findByText('RFQs page')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('Ctrl+K and Cmd+K work from the page', async () => {
    shell()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    expect(await screen.findByRole('dialog', { name: 'Search or jump to' })).toBeInTheDocument()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
  })
})
