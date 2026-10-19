import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import { AppShell } from '@/app/shell/AppShell'
import { BottomTabs, MobileBar } from '@/app/shell/MobileChrome'
import { TopBar } from '@/app/shell/TopBar'
import { installFakeDb } from '@/test/fakeSupabase'

const user = { id: 'u1', name: 'Farhan Mirza', role: 'admin' }

describe('phone tabs: the top bar counts as badges', () => {
  it('a count shows on the icon and is read with the label; no badge for zero or no count', () => {
    render(
      <MemoryRouter initialEntries={['/today']}>
        <BottomTabs role="admin" counts={{ today: 9, rfqs: 140, orders: 0 }} />
      </MemoryRouter>,
    )
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: /^Today\s*9$/ })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /^RFQs\s*140$/ })).toHaveTextContent('99+')
    expect(within(nav).getByRole('link', { name: 'Orders' }).querySelector('[data-count]')).toBeNull()
    expect(within(nav).getByRole('link', { name: 'Companies' }).querySelector('[data-count]')).toBeNull()
  })

  it('every column is at least as wide as its label, so a long label never clips', () => {
    render(
      <MemoryRouter>
        <BottomTabs role="admin" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('navigation', { name: 'Main' }).style.gridTemplateColumns).toMatch(/minmax\(min-content, 1fr\)/)
  })
})

describe('Paste or photo (was Capture; plain-words glossary)', () => {
  it('the top bar and the phone bar both name the action "Paste or photo" and run it', async () => {
    let opened = 0
    const u = userEvent.setup()
    render(
      <MemoryRouter>
        <TopBar user={user} onCapture={() => opened++} />
        <MobileBar user={user} title="Today" onCapture={() => opened++} />
      </MemoryRouter>,
    )
    const buttons = screen.getAllByRole('button', { name: 'Paste or photo' })
    expect(buttons).toHaveLength(2)
    for (const b of buttons) await u.click(b)
    expect(opened).toBe(2)
    expect(screen.queryByRole('button', { name: /Capture/ })).toBeNull()
  })
})

describe('palette Jump to: Settings pages (audit: hidden behind the avatar)', () => {
  const shell = (role: string) => {
    installFakeDb(() => ({ data: [] }))
    const session: SessionState = { status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role } }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SessionProvider value={session}>
          <MemoryRouter initialEntries={['/today']}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/today" element={<p>Today page</p>} />
                <Route path="/settings/exchange-rates" element={<p>Rates page</p>} />
                <Route path="/settings/details" element={<p>Details page</p>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>,
    )
  }
  const search = async (u: ReturnType<typeof userEvent.setup>, q: string) => {
    await u.click(screen.getAllByRole('button', { name: 'Search or jump to' })[0])
    const dlg = await screen.findByRole('dialog', { name: 'Search or jump to' })
    await u.keyboard(q)
    return dlg
  }

  it('an admin finds Exchange rates, Targets, Team and Expense categories by name', async () => {
    const u = userEvent.setup()
    shell('admin')
    const dlg = await search(u, 'rates')
    expect(await within(dlg).findByRole('option', { name: /Exchange rates/ })).toBeInTheDocument()
    await u.keyboard('{Enter}')
    expect(await screen.findByText('Rates page')).toBeInTheDocument()
  })

  for (const [q, label] of [['targets', 'Targets'], ['team', 'Team'], ['categories', 'Expense categories']] as const) {
    it(`admin: "${q}" finds ${label}`, async () => {
      const u = userEvent.setup()
      shell('admin')
      const dlg = await search(u, q)
      expect(await within(dlg).findByRole('option', { name: new RegExp(label) })).toBeInTheDocument()
    })
  }

  it('a sales person finds Settings and Your details, but no admin page', async () => {
    const u = userEvent.setup()
    shell('sales')
    let dlg = await search(u, 'your details')
    expect(await within(dlg).findByRole('option', { name: /Your details/ })).toBeInTheDocument()
    await u.keyboard('{Enter}')
    expect(await screen.findByText('Details page')).toBeInTheDocument()
    dlg = await search(u, 'exchange')
    expect(within(dlg).queryByRole('option', { name: /Exchange rates/ })).toBeNull()
  })
})
