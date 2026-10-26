import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { SessionUser } from '@/app/session'
import { useMobileBar, type MobileBarConfig } from '@/app/shell/MobileBarContext'
import { MobileBarProvider } from '@/app/shell/MobileBarProvider'
import { BottomTabs, MobileBar } from '@/app/shell/MobileChrome'

/*
 * The phone bar's one-bar form (UX audit 2026-10-19): a detail page sets title, back, actions and hideTabs through
 * useMobileBar; the shell then draws one bar (back + title + actions) instead of logo, search, Capture and avatar.
 */
const user: SessionUser = { id: 'u1', name: 'Ayesha Rana', role: 'sales' }

function Where() {
  const { pathname } = useLocation()
  return <p data-testid="where">{pathname}</p>
}

function Detail({ config, children }: { config: MobileBarConfig; children?: ReactNode }) {
  useMobileBar(config)
  return <div>{children ?? <p>Detail page</p>}</div>
}

const more = <button type="button">More</button>

function shell(entries: string[], routes: ReactNode) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <MobileBarProvider>
        <MobileBar user={user} title="RFQs" onSearch={() => {}} />
        <Routes>
          <Route path="/" element={<p>Home</p>} />
          <Route path="/today" element={<p>Today page</p>} />
          <Route path="/rfqs" element={<p>RFQs page</p>} />
          {routes}
        </Routes>
        <BottomTabs role="sales" />
        <Where />
      </MobileBarProvider>
    </MemoryRouter>,
  )
}

const where = () => screen.getByTestId('where').textContent

describe('phone bar: the one-bar form', () => {
  it('default: logo, title, search, avatar, and the tab bar (no Paste or photo button)', () => {
    shell(['/rfqs'], null)
    expect(screen.getByRole('link', { name: 'Q-Tech, home' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Paste or photo' })).toBeNull()
    expect(screen.getByRole('button', { name: /Account menu/ })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  it('a detail page gets ONE bar (back, its title, its actions) and hideTabs removes the tab bar', () => {
    shell(['/rfqs/177'], <Route path="/rfqs/:id" element={<Detail config={{ title: 'RFQ-0177', back: 'history', fallback: '/rfqs', actions: more, hideTabs: true }} />} />)
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(screen.getByText('RFQ-0177')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Q-Tech, home' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Paste or photo' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Account menu/ })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
  })

  it("back 'history' returns to the screen the person came from", async () => {
    const u = userEvent.setup()
    shell(['/today', '/rfqs/177'], <Route path="/rfqs/:id" element={<Detail config={{ title: 'RFQ-0177', back: 'history', fallback: '/rfqs' }} />} />)
    await u.click(screen.getByRole('button', { name: 'Back' }))
    expect(where()).toBe('/today')
  })

  it("back 'history' goes to the fallback when the page was opened directly (no previous screen in the app)", async () => {
    const u = userEvent.setup()
    shell(['/rfqs/177'], <Route path="/rfqs/:id" element={<Detail config={{ title: 'RFQ-0177', back: 'history', fallback: '/rfqs' }} />} />)
    await u.click(screen.getByRole('button', { name: 'Back' }))
    expect(where()).toBe('/rfqs')
    expect(screen.getByText('RFQs page')).toBeInTheDocument()
  })

  it("back 'history' with no fallback goes home", async () => {
    const u = userEvent.setup()
    shell(['/rfqs/177'], <Route path="/rfqs/:id" element={<Detail config={{ back: 'history' }} />} />)
    await u.click(screen.getByRole('button', { name: 'Back' }))
    expect(where()).toBe('/')
  })

  it('back as a route goes there', async () => {
    const u = userEvent.setup()
    shell(['/today', '/rfqs/177'], <Route path="/rfqs/:id" element={<Detail config={{ title: 'RFQ-0177', back: '/rfqs' }} />} />)
    await u.click(screen.getByRole('button', { name: 'Back' }))
    expect(where()).toBe('/rfqs')
  })

  it('leaving the page brings back the default bar and the tab bar', async () => {
    const u = userEvent.setup()
    shell(
      ['/rfqs/177'],
      <Route
        path="/rfqs/:id"
        element={
          <Detail config={{ title: 'RFQ-0177', back: '/rfqs', hideTabs: true }}>
            <Link to="/today">Go to Today</Link>
          </Detail>
        }
      />,
    )
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    await u.click(screen.getByRole('link', { name: 'Go to Today' }))
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  it('going from one detail page straight to another shows the new page’s bar', async () => {
    const u = userEvent.setup()
    shell(
      ['/rfqs/177'],
      <>
        <Route
          path="/rfqs/:id"
          element={
            <Detail config={{ title: 'RFQ-0177', back: '/rfqs' }}>
              <Link to="/orders/38">Open the order</Link>
            </Detail>
          }
        />
        <Route path="/orders/:id" element={<Detail config={{ title: 'ORD-0038', back: 'history', hideTabs: true }} />} />
      </>,
    )
    await u.click(screen.getByRole('link', { name: 'Open the order' }))
    expect(screen.getByText('ORD-0038')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    await u.click(screen.getByRole('button', { name: 'Back' }))
    expect(where()).toBe('/rfqs/177')
    expect(screen.getByText('RFQ-0177')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  it('the original shape still works: back object with a label, `action` in the right slot (TeamPage)', async () => {
    const u = userEvent.setup()
    shell(
      ['/settings/team'],
      <Route path="/settings/team" element={<Detail config={{ title: 'Team', back: { to: '/', label: 'Back to settings' }, action: <button type="button">Add</button> }} />} />,
    )
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument() // tabs stay unless asked
    await u.click(screen.getByRole('button', { name: 'Back to settings' }))
    expect(where()).toBe('/')
  })

  it('`actions` wins over `action`; a close (x) runs its onClick', async () => {
    const u = userEvent.setup()
    let closed = 0
    shell(
      ['/capture'],
      <Route
        path="/capture"
        element={<Detail config={{ title: 'Paste or photo', close: { onClick: () => (closed += 1) }, actions: more, action: <button type="button">Old</button> }} />}
      />,
    )
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Old' })).toBeNull()
    await u.click(screen.getByRole('button', { name: 'Close' }))
    expect(closed).toBe(1)
  })
})
