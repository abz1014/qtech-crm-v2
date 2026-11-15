import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeAll, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import { AppShell } from '@/app/shell/AppShell'
import { BottomTabs, MobileBar } from '@/app/shell/MobileChrome'
import { Rail } from '@/app/shell/Rail'
import { TopBar } from '@/app/shell/TopBar'
import { settingsLinksFor } from '@/features/settings/settingsLinks'
import { installFakeDb } from '@/test/fakeSupabase'

const user = { id: 'u1', name: 'Farhan Mirza', role: 'admin' }

function Where() {
  const l = useLocation()
  return <output data-testid="where">{`${l.pathname}${l.search}`}</output>
}

describe('phone bottom bar (86-phone-shell.html#ps-bars)', () => {
  it('Home carries the number on its icon and in its name; Money a red dot; no badge for zero or no count', () => {
    render(
      <MemoryRouter initialEntries={['/todo']}>
        <BottomTabs role="admin" counts={{ today: 140 }} dots={{ money: true }} />
      </MemoryRouter>,
    )
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const home = within(nav).getByRole('link', { name: /^Home\s?, 140 due now$/ })
    expect(home).toHaveTextContent('99+')
    expect(home).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Sell' }).querySelector('[data-needs-count]')).toBeNull()
    expect(within(nav).getByRole('link', { name: 'Deliver' }).querySelector('[data-needs-count]')).toBeNull()
    // Companies is not on the phone bar (owner decision 12 Nov 2026): it is reached from Home and Search
    expect(within(nav).queryByRole('link', { name: 'Companies' })).toBeNull()
    // Money has no number, only a red dot while an invoice is late, and its name says so
    const money = within(nav).getByRole('link', { name: /^Money\s?, an invoice is late$/ })
    expect(money.querySelector('[data-needs-count]')).toBeNull()
    expect(money.querySelector('[data-late-dot]')).not.toBeNull()
  })

  it('five equal columns that may shrink (no label is wider than its column at 320: e2e/gallery.visual.spec.ts measures it)', () => {
    render(
      <MemoryRouter>
        <BottomTabs role="admin" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('navigation', { name: 'Main' }).style.gridTemplateColumns).toBe('repeat(5, minmax(0, 1fr))')
  })

  it('the + opens the Create sheet with the live rows, and a row goes to its screen', async () => {
    render(
      <MemoryRouter initialEntries={['/todo']}>
        <BottomTabs role="admin" />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    )
    const u = userEvent.setup()
    await u.click(screen.getByRole('button', { name: 'Create' }))
    const sheet = await screen.findByRole('dialog', { name: 'Create' })
    expect(within(sheet).getAllByRole('button').map(b => b.textContent).filter(t => t && t !== 'Close')).toEqual(['New RFQ', 'Expense', 'Payment received', 'Order without RFQ'])
    await u.click(within(sheet).getByRole('button', { name: 'Order without RFQ' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/orders?new=1')
  })

  it('an engineer gets Home, Camera, I paid and Jobs, and no +', () => {
    render(
      <MemoryRouter initialEntries={['/capture']}>
        <BottomTabs role="engineer" counts={{ today: 2 }} />
      </MemoryRouter>,
    )
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['/todo', '/capture', '/my-expenses', '/jobs'])
    expect(within(nav).getByRole('link', { name: 'Camera' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).queryByRole('button', { name: 'Create' })).toBeNull()
    expect(nav.textContent).not.toMatch(/Money|Sell|Deliver/)
  })
})

describe('the forest rail (768 up)', () => {
  it('admin: the lime Create, the lanes with Companies under a divider, the number and the late dot read out with the words', () => {
    render(
      <MemoryRouter initialEntries={['/jobs?lane=sell']}>
        <Rail user={user} counts={{ today: 3 }} dots={{ money: true }} collapsed={false} onToggle={() => {}} />
      </MemoryRouter>,
    )
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: /^Home\s?, 3 due now$/ })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /^Money\s?, an invoice is late$/ })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Sell' })).toHaveAttribute('aria-current', 'page')
    expect(nav.querySelector('hr')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('collapsed (and from 768 to 1023): every word stays in the name, drawn for screen readers only', () => {
    render(
      <MemoryRouter initialEntries={['/todo']}>
        <Rail user={user} collapsed onToggle={() => {}} />
      </MemoryRouter>,
    )
    const nav = screen.getByRole('navigation', { name: 'Main' })
    for (const name of ['Home', 'Sell', 'Deliver', 'Money', 'Companies']) {
      const label = within(nav).getByRole('link', { name }).querySelector('[data-nav-label]') as HTMLElement
      expect(label.className).toContain('sr-only')
    }
    expect(screen.getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('an engineer: Take photo instead of Create, and Home, I paid, Jobs', () => {
    render(
      <MemoryRouter initialEntries={['/todo']}>
        <Rail user={{ ...user, role: 'engineer' }} collapsed={false} onToggle={() => {}} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Take photo' })).toHaveAttribute('href', '/capture')
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('link').map(a => a.textContent)).toEqual(['Home', 'I paid', 'Jobs'])
  })
})

describe('top bar: Search, then Help, Settings, the role and the initial (81-create-account.html#ca-bar)', () => {
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
      expect(screen.getByRole('button', { name: 'Search or jump to' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Account menu/ })).toBeInTheDocument()
      await userEvent.setup().click(screen.getByRole('button', { name: 'Help' }))
      expect(screen.getByTestId('where')).toHaveTextContent('help=')
      unmount()
    }
  })

  it('the phone band: the title, then Search, Help and the account initial; no Create word in it (R-004)', async () => {
    render(
      <MemoryRouter initialEntries={['/todo']}>
        <MobileBar user={user} title="Companies" />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('Companies')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(New|Create)$/ })).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Help' }))
    expect(screen.getByTestId('where')).toHaveTextContent('help=')
    expect(screen.getByRole('button', { name: /Account menu/ })).toBeInTheDocument()
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
