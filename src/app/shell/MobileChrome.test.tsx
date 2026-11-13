import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeAll, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import { AppShell } from '@/app/shell/AppShell'
import { BottomTabs, MobileBar } from '@/app/shell/MobileChrome'
import { TopBar } from '@/app/shell/TopBar'
import { settingsLinksFor } from '@/features/settings/settingsLinks'
import { installFakeDb } from '@/test/fakeSupabase'

const user = { id: 'u1', name: 'Farhan Mirza', role: 'admin' }

function Where() {
  const l = useLocation()
  return <output data-testid="where">{`${l.pathname}${l.search}`}</output>
}

describe('phone tabs: the top bar counts as badges', () => {
  it('a count shows on the icon and is read with the label; no badge for zero or no count', () => {
    render(
      <MemoryRouter initialEntries={['/todo']}>
        <BottomTabs role="admin" counts={{ today: 140 }} dots={{ money: true }} />
      </MemoryRouter>,
    )
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: /^To do\s?, 140 due now$/ })).toHaveTextContent('99+')
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

describe('top bar at 768 to 1023 and the Help and Settings buttons (navigation review)', () => {
  it('every destination keeps its word and its count from md up: no label is screen-reader-only, no count or dot is hidden below lg', () => {
    render(
      <MemoryRouter initialEntries={['/todo']}>
        <TopBar user={user} counts={{ today: 3, jobs: 2 }} dots={{ money: true }} />
      </MemoryRouter>,
    )
    const nav = screen.getByRole('navigation', { name: 'Main' })
    for (const name of ['To do', 'Jobs', 'Money', 'Companies']) {
      const label = within(nav).getByRole('link', { name: new RegExp('^' + name) }).querySelector('[data-nav-label]') as HTMLElement
      expect(label.textContent).toBe(name)
      expect(label.className).not.toMatch(/sr-only/)
    }
    const counts = [...nav.querySelectorAll('[data-needs-count], [data-late-dot]')]
    expect(counts).toHaveLength(3)
    for (const c of counts) expect(c.className).not.toMatch(/max-lg:hidden/)
  })

  it('Help and Settings are in the bar for every role, Settings goes to /settings and Help opens the Help panel', async () => {
    for (const role of ['admin', 'sales', 'engineer']) {
      const { unmount } = render(
        <MemoryRouter initialEntries={['/todo']}>
          <TopBar user={{ ...user, role }} />
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>,
      )
      expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
      await userEvent.setup().click(screen.getByRole('button', { name: 'Help' }))
      expect(screen.getByTestId('where')).toHaveTextContent('help=')
      unmount()
    }
  })

  it('the phone bar has a Help button beside Search, and the account menu is still there', async () => {
    render(
      <MemoryRouter initialEntries={['/todo']}>
        <MobileBar user={user} title="To do" />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Help' }))
    expect(screen.getByTestId('where')).toHaveTextContent('help=')
    expect(screen.getByRole('button', { name: /Account menu/ })).toBeInTheDocument()
  })
})

describe('the phone bar New button shows its word', () => {
  it('admin: the button reads "New" (visible text, same accessible name) beside Search and Help', () => {
    render(
      <MemoryRouter initialEntries={['/todo']}>
        <MobileBar user={user} title="Companies" />
      </MemoryRouter>,
    )
    const btn = screen.getByRole('button', { name: 'New' })
    expect(btn).toHaveTextContent('New')
    // below 360 px the word hides (the title "Companies" does not fit beside it at 320) and the name stays
    expect(btn).toHaveAttribute('aria-label', 'New')
    expect(btn.querySelector('span')?.className).toContain('max-[359px]:hidden')
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
  })

  it('an engineer has no New button on the phone bar', () => {
    render(
      <MemoryRouter initialEntries={['/todo']}>
        <MobileBar user={{ ...user, role: 'engineer' }} title="To do" />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull()
  })
})

describe('Paste or photo (retired by New enquiry and Add to this job, P4)', () => {
  it('neither the top bar nor the phone bar has a Paste or photo button any more', () => {
    render(
      <MemoryRouter>
        <TopBar user={user} />
        <MobileBar user={user} title="Today" />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: /Paste or photo|Capture/ })).toBeNull()
  })
})

describe('palette Jump to: Settings pages (audit: hidden behind the avatar)', () => {
  // The palette is a lazy chunk, and its first import (Radix, cmdk, a Vite transform shared by every worker) can take several seconds when the suite runs in parallel,
  // longer than any findBy. Load it first, with a hook timeout of its own, so the tests only exercise opening it.
  beforeAll(async () => {
    await import('@/ui/CommandPalette')
    // the palette's search loads the jobs code with the first search (src/features/search/paletteSource.ts): not inside a test's wait
    await Promise.all([import('@/features/jobs/api'), import('@/features/jobs/lib/stages')])
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
    // (the palette redraws its list as its sources arrive, so a test must not keep hold of an option element: findByRole alone is the assertion)
    // wait for the search box to take focus before typing: on a loaded runner the first keystrokes otherwise go nowhere
    await waitFor(() => expect(within(dlg).getByRole('combobox')).toHaveFocus())
    await u.keyboard(q)
    return dlg
  }

  it('admin and sales find Exchange rates, as the Settings menu offers it to them, and Enter opens it', async () => {
    for (const role of ['admin', 'sales']) {
      const u = userEvent.setup()
      shell(role)
      const dlg = await search(u, 'rates')
      await within(dlg).findByRole('option', { name: /Exchange rates/ })
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
      await within(dlg).findByRole('option', { name: new RegExp(label) })
    })
  }

  it('a sales person finds Your details, Company profile and Change password, but no admin page', async () => {
    const u = userEvent.setup()
    shell('sales')
    let dlg = await search(u, 'your details')
    await within(dlg).findByRole('option', { name: /Your details/ })
    await u.keyboard('{Enter}')
    expect(await screen.findByText('Details page')).toBeInTheDocument()
    for (const [q, label] of [['company', 'Company profile'], ['password', 'Change password']]) {
      dlg = await search(u, q)
      await within(dlg).findByRole('option', { name: new RegExp(label) })
      await u.keyboard('{Escape}')
    }
    dlg = await search(u, 'targets')
    expect(within(dlg).queryByRole('option', { name: /Targets/ })).toBeNull()
  })

  it('"paste or photo", "capture" and "paste" still find New enquiry', async () => {
    for (const q of ['paste or photo', 'capture', 'paste']) {
      const u = userEvent.setup()
      shell('sales')
      const dlg = await search(u, q)
      await within(dlg).findByRole('option', { name: /New RFQ/ })
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
      if (found) await within(dlg).findByRole('option', { name: /^Reports/ })
      else expect(within(dlg).queryByRole('option', { name: /^Reports/ })).toBeNull()
      cleanup()
    }
  })
})
