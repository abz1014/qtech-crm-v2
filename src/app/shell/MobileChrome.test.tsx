import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeAll, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import { AppShell } from '@/app/shell/AppShell'
import { BottomTabs, MobileBar } from '@/app/shell/MobileChrome'
import { TopBar } from '@/app/shell/TopBar'
import { settingsLinksFor } from '@/features/settings/settingsLinks'
import { installFakeDb } from '@/test/fakeSupabase'

const user = { id: 'u1', name: 'Farhan Mirza', role: 'admin' }

describe('phone tabs: the top bar counts as badges', () => {
  it('a count shows on the icon and is read with the label; no badge for zero or no count', () => {
    render(
      <MemoryRouter initialEntries={['/todo']}>
        <BottomTabs role="admin" counts={{ today: 140 }} dots={{ money: true }} />
      </MemoryRouter>,
    )
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: /^To do\s?, 140 need you$/ })).toHaveTextContent('99+')
    expect(within(nav).getByRole('link', { name: 'Jobs' }).querySelector('[data-needs-count]')).toBeNull()
    expect(within(nav).getByRole('link', { name: 'Companies' }).querySelector('[data-needs-count]')).toBeNull()
    // Money has no number, only a red dot while an invoice is late, and its name says so
    const money = within(nav).getByRole('link', { name: /^Money\s?, an invoice is late$/ })
    expect(money.querySelector('[data-needs-count]')).toBeNull()
    expect(money.querySelector('[data-late-dot]')).not.toBeNull()
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
  // The palette is a lazy chunk, and its first import (Radix, cmdk, a Vite transform shared by every worker) can take several seconds when the suite runs in parallel,
  // longer than any findBy. Load it first, with a hook timeout of its own, so the tests only exercise opening it.
  beforeAll(async () => {
    await import('@/ui/CommandPalette')
  }, 60_000)

  const shell = (role: string) => {
    installFakeDb(() => ({ data: [] }))
    const session: SessionState = { status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role } }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SessionProvider value={session}>
          <MemoryRouter initialEntries={['/todo']}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/todo" element={<p>Today page</p>} />
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

  it('admin and sales find Exchange rates, as the Settings menu offers it to them, and Enter opens it', async () => {
    for (const role of ['admin', 'sales']) {
      const u = userEvent.setup()
      shell(role)
      const dlg = await search(u, 'rates')
      expect(await within(dlg).findByRole('option', { name: /Exchange rates/ })).toBeInTheDocument()
      await u.keyboard('{Enter}')
      expect(await screen.findByText('Rates page')).toBeInTheDocument()
      cleanup()
    }
  })

  it('an engineer is not offered Exchange rates (owner decision 2026-10-22: no currency amounts)', async () => {
    const u = userEvent.setup()
    shell('engineer')
    const dlg = await search(u, 'exchange rates')
    expect(within(dlg).queryByRole('option', { name: /Exchange rates/ })).toBeNull()
  })

  it('Jump to offers exactly the Settings pages the Settings menu lists for the role (one list, settingsLinks.ts)', async () => {
    for (const role of ['admin', 'sales', 'engineer'] as const) {
      const u = userEvent.setup()
      shell(role)
      const dlg = await search(u, 'settings')
      const want = settingsLinksFor(role).map(l => l.label)
      // Only the Jump to group: other groups (Actions, Help) rightly match the word "settings" too ("Add "settings" as a new company",
      // help articles), and they load later, so counting every row in the dialog was the flake.
      // The "Settings" row itself plus one row per page the role may open; asserted together so rows re-rendered mid-typing are retried.
      await waitFor(() => {
        const jump = within(dlg).getByRole('group', { name: 'Jump to' })
        const names = within(jump).getAllByRole('option').map(o => o.textContent ?? '')
        expect(names.filter(n => n.endsWith('Settings')).sort()).toEqual(want.map(l => `${l}Settings`).sort())
        expect(names).toHaveLength(want.length + 1)
      })
      cleanup()
    }
  })

  for (const [q, label] of [['targets', 'Targets'], ['team', 'Team'], ['categories', 'Expense categories'], ['company', 'Company profile'], ['password', 'Change password']] as const) {
    it(`admin: "${q}" finds ${label}`, async () => {
      const u = userEvent.setup()
      shell('admin')
      const dlg = await search(u, q)
      expect(await within(dlg).findByRole('option', { name: new RegExp(label) })).toBeInTheDocument()
    })
  }

  it('a sales person finds Your details, Company profile and Change password, but no admin page', async () => {
    const u = userEvent.setup()
    shell('sales')
    let dlg = await search(u, 'your details')
    expect(await within(dlg).findByRole('option', { name: /Your details/ })).toBeInTheDocument()
    await u.keyboard('{Enter}')
    expect(await screen.findByText('Details page')).toBeInTheDocument()
    for (const [q, label] of [['company', 'Company profile'], ['password', 'Change password']]) {
      dlg = await search(u, q)
      expect(await within(dlg).findByRole('option', { name: new RegExp(label) })).toBeInTheDocument()
      await u.keyboard('{Escape}')
    }
    dlg = await search(u, 'targets')
    expect(within(dlg).queryByRole('option', { name: /Targets/ })).toBeNull()
  })

  it('"capture" and "paste" still find Paste or photo', async () => {
    for (const q of ['capture', 'paste']) {
      const u = userEvent.setup()
      shell('sales')
      const dlg = await search(u, q)
      expect(await within(dlg).findByRole('option', { name: /Paste or photo/ })).toBeInTheDocument()
      cleanup()
    }
  })

  it('the Money pages follow the Money tabs: sales find To collect and Invoices, only admins the rest', async () => {
    const admin = ['To collect', 'Invoices', 'Reports', 'Expenses', 'Add expenses', 'Lock a month', 'Bank check', 'Order margins', 'Mistakes to fix']
    for (const [role, want] of [['admin', admin], ['sales', ['To collect', 'Invoices', 'Reports']], ['engineer', []]] as const) {
      const u = userEvent.setup()
      shell(role)
      const dlg = await search(u, 'money')
      for (const label of admin) {
        const found = within(dlg).queryAllByRole('option').some(o => o.textContent?.startsWith(label))
        expect(found, `${role}: ${label}`).toBe((want as readonly string[]).includes(label))
      }
      cleanup()
    }
  })

  it('"reports" finds Reports for admin and sales, never for an engineer', async () => {
    for (const [role, found] of [['admin', true], ['sales', true], ['engineer', false]] as const) {
      const u = userEvent.setup()
      shell(role)
      const dlg = await search(u, 'reports')
      if (found) expect(await within(dlg).findByRole('option', { name: /^Reports/ })).toBeInTheDocument()
      else expect(within(dlg).queryByRole('option', { name: /^Reports/ })).toBeNull()
      cleanup()
    }
  })
})
