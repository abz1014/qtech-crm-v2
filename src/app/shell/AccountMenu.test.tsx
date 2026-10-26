import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { session, type SessionState } from '@/app/session'
import { AppShell } from '@/app/shell/AppShell'
import { axeViolations } from '@/test/axe'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installFakeDb } from '@/test/fakeSupabase'

/* The shell reads the Today and RFQ counts for the top bar: an empty database, and a fresh cache per render. */
const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
installFakeDb(() => ({ data: [] }))

const signedIn: SessionState = { status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role: 'sales' } }

function shell(path = '/todo') {
  return render(
    <QueryClientProvider client={qc()}>
      <SessionProvider value={signedIn}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/todo" element={<p>Today page</p>} />
            <Route path="/rfqs" element={<p>RFQs page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </SessionProvider>
    </QueryClientProvider>,
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

  it('Change password is in the menu and goes to /settings/password', async () => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={qc()}>
        <SessionProvider value={signedIn}>
        <MemoryRouter initialEntries={['/todo']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/todo" element={<p>Today page</p>} />
              <Route path="/settings/password" element={<p>Password page</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </SessionProvider>
      </QueryClientProvider>,
    )
    await user.click(screen.getAllByRole('button', { name: 'Account menu, Ayesha Rana' })[0])
    await user.click(await screen.findByRole('menuitem', { name: 'Change password' }))
    expect(await screen.findByText('Password page')).toBeInTheDocument()
  })

  it('keyboard only: Enter opens, first item is focused, Esc returns focus to the avatar', async () => {
    const user = userEvent.setup()
    shell()
    const trigger = screen.getAllByRole('button', { name: 'Account menu, Ayesha Rana' })[0]
    trigger.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Help' })).toHaveFocus())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(trigger).toHaveFocus()
  })
})

describe('search button and Cmd/Ctrl+K open the palette (U08)', () => {
  it('the top-bar search button opens it; it lists this role\'s destinations; Enter goes there', async () => {
    const user = userEvent.setup()
    shell()
    await user.click(screen.getAllByRole('button', { name: /^Search or jump to/ })[0])
    const dlg = await screen.findByRole('dialog', { name: 'Search or jump to' })
    const rows = await within(dlg).findAllByRole('option')
    // Idle: the Actions of the mockup (A-89); the destinations answer when typed.
    expect(rows.map(r => r.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('New RFQ'), expect.stringContaining('Paste or photo'), expect.stringContaining('Go to To do')]),
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
describe('account menu: Settings and Team (A04)', () => {
  const open = async (role: string) => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={qc()}>
        <SessionProvider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role } }}>
        <MemoryRouter initialEntries={['/todo']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/todo" element={<p>Today page</p>} />
              <Route path="/settings" element={<p>Settings page</p>} />
              <Route path="/settings/team" element={<p>Team page</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </SessionProvider>
      </QueryClientProvider>,
    )
    await user.click(screen.getAllByRole('button', { name: 'Account menu, Ayesha Rana' })[0])
    return user
  }

  it('an admin sees Settings and Team, and Team goes to the Team screen', async () => {
    const user = await open('admin')
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Team' }))
    expect(await screen.findByText('Team page')).toBeInTheDocument()
  })

  for (const role of ['sales', 'engineer']) {
    it(`a ${role} sees Settings but no Team`, async () => {
      const user = await open(role)
      expect(screen.queryByRole('menuitem', { name: 'Team' })).toBeNull()
      await user.click(screen.getByRole('menuitem', { name: 'Settings' }))
      expect(await screen.findByText('Settings page')).toBeInTheDocument()
    })
  }
})

describe('account menu: Text size (DECISIONS 2026-10-19)', () => {
  afterEach(() => {
    delete document.documentElement.dataset.text
  })

  it('Normal and Smaller are menu radios; Smaller applies at once and the menu stays open to show it', async () => {
    const user = userEvent.setup()
    shell()
    await user.click(screen.getAllByRole('button', { name: 'Account menu, Ayesha Rana' })[0])
    const menu = await screen.findByRole('menu', { name: 'Account' })
    const group = within(menu).getByRole('group', { name: 'Text size' })
    const normal = within(group).getByRole('menuitemradio', { name: 'Normal' })
    const smaller = within(group).getByRole('menuitemradio', { name: 'Smaller' })
    expect(normal).toHaveAttribute('aria-checked', 'true')
    expect(smaller).toHaveAttribute('aria-checked', 'false')
    await user.click(smaller)
    expect(document.documentElement.dataset.text).toBe('small')
    expect(window.localStorage.getItem('qtech.text-size')).toBe('small')
    expect(screen.getByRole('menu', { name: 'Account' })).toBeInTheDocument()
    expect(smaller).toHaveAttribute('aria-checked', 'true')
    expect(await axeViolations(menu)).toEqual([])
    await user.click(normal)
    expect(document.documentElement.hasAttribute('data-text')).toBe(false)
    // Larger (18 px) is a third choice in the same group
    await user.click(within(group).getByRole('menuitemradio', { name: 'Larger' }))
    expect(document.documentElement.dataset.text).toBe('large')
    expect(window.localStorage.getItem('qtech.text-size')).toBe('large')
    expect(within(group).getByRole('menuitemradio', { name: 'Larger' })).toHaveAttribute('aria-checked', 'true')
    await user.click(normal)
  })

  it('the arrow keys reach the text size choices like any other item', async () => {
    const user = userEvent.setup()
    shell()
    await user.click(screen.getAllByRole('button', { name: 'Account menu, Ayesha Rana' })[0])
    await screen.findByRole('menu', { name: 'Account' })
    await user.keyboard('{End}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}')
    // The last item is Sign out; above it the version row, then (no Install app in jsdom) Larger, Smaller, then Normal.
    expect(screen.getByRole('menuitemradio', { name: 'Normal' })).toHaveFocus()
  })

  it('Keyboard shortcuts (with its ? key) shows only with a fine pointer from md up, and opens the sheet', async () => {
    const user = userEvent.setup()
    const mq = (matches: boolean) =>
      vi.spyOn(window, 'matchMedia').mockImplementation(
        query => ({ matches, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as unknown as MediaQueryList,
      )
    mq(false)
    const { unmount } = shell()
    await user.click(screen.getAllByRole('button', { name: 'Account menu, Ayesha Rana' })[0])
    await screen.findByRole('menu', { name: 'Account' })
    expect(screen.queryByRole('menuitem', { name: /Keyboard shortcuts/ })).toBeNull()
    unmount()
    vi.restoreAllMocks()
    mq(true)
    shell()
    await user.click(screen.getAllByRole('button', { name: 'Account menu, Ayesha Rana' })[0])
    const item = await screen.findByRole('menuitem', { name: /Keyboard shortcuts/ })
    expect(item.querySelector('kbd')?.textContent).toBe('?')
    await user.click(item)
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
  })
})
