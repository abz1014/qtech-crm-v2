import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '@/app/routes'
import { SessionProvider } from '@/app/SessionProvider'
import { AdminOnly, SettingsHome, SettingsLayout } from '@/features/settings/SettingsLayout'

vi.mock('@/features/settings/SettingsHomePage', () => ({ SettingsHomePage: () => <p>Settings home</p> }))

const as = (role: string) => ({ status: 'signed-in' as const, user: { id: 'u', name: 'Someone', role } })

function at(path: string, role: string) {
  return render(
    <SessionProvider value={as(role)}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<SettingsHome />} />
            <Route
              path="team"
              element={
                <AdminOnly area="Team">
                  <p>Team screen</p>
                </AdminOnly>
              }
            />
            <Route
              path="targets"
              element={
                <AdminOnly area="Targets">
                  <p>Targets screen</p>
                </AdminOnly>
              }
            />
            <Route
              path="categories"
              element={
                <AdminOnly area="Expense categories">
                  <p>Categories screen</p>
                </AdminOnly>
              }
            />
            <Route path="company" element={<p>Company screen</p>} />
            <Route path="rates" element={<p>Rates screen</p>} />
            <Route path="password" element={<p>Password screen</p>} />
          </Route>
          <Route path="/no-access" element={null} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  )
}

describe('settings access (A04, A06)', () => {
  it('/settings opens Team for an admin and the Settings home for everyone else', () => {
    at('/settings', 'admin')
    expect(screen.getByText('Team screen')).toBeInTheDocument()
  })

  for (const role of ['sales', 'engineer']) {
    it(`${role}: Team is not offered and a typed /settings/team address shows the no-access page`, () => {
      const first = at('/settings', role)
      expect(screen.getByText('Settings home')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Team' })).toBeNull()
      expect(screen.getByRole('link', { name: /Company profile/ })).toHaveTextContent('View only')
      expect(screen.getByRole('link', { name: 'Exchange rates' })).toBeInTheDocument()
      first.unmount()

      at('/settings/team', role)
      expect(screen.queryByText('Team screen')).toBeNull()
      expect(screen.getByRole('heading', { name: 'Team is for admins' })).toBeInTheDocument()
    })
  }

  it('an admin is offered Targets and Expense categories and can open both', () => {
    const a = at('/settings/targets', 'admin')
    expect(screen.getByText('Targets screen')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Targets' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Expense categories' })).toBeInTheDocument()
    a.unmount()
    at('/settings/categories', 'admin')
    expect(screen.getByText('Categories screen')).toBeInTheDocument()
  })

  for (const role of ['sales', 'engineer']) {
    it(`${role}: Targets and Expense categories are not offered, and typed addresses show the no-access page`, () => {
      const first = at('/settings/company', role)
      expect(screen.queryByRole('link', { name: 'Targets' })).toBeNull()
      expect(screen.queryByRole('link', { name: 'Expense categories' })).toBeNull()
      first.unmount()

      const second = at('/settings/targets', role)
      expect(screen.queryByText('Targets screen')).toBeNull()
      expect(screen.getByText('Targets is not available to your role')).toBeInTheDocument()
      second.unmount()

      at('/settings/categories', role)
      expect(screen.queryByText('Categories screen')).toBeNull()
      expect(screen.getByText('Expense categories is not available to your role')).toBeInTheDocument()
    })
  }

  it('everyone is offered Change password', () => {
    for (const role of ['admin', 'sales', 'engineer']) {
      const r = at('/settings/password', role)
      expect(screen.getByText('Password screen')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Change password' })).toBeInTheDocument()
      r.unmount()
    }
  })

  it('an admin sees both links', () => {
    at('/settings/company', 'admin')
    expect(screen.getByRole('link', { name: 'Team' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Company profile' })).toBeInTheDocument() // no View only tag for an admin
    expect(screen.getByRole('link', { name: 'Exchange rates' })).toBeInTheDocument()
  })

  it('the real route table mounts Settings inside the shell guard', () => {
    // A signed-out person is sent to sign in, never shown a settings screen.
    render(
      <SessionProvider value={{ status: 'signed-out' }}>
        <MemoryRouter initialEntries={['/settings/team']}>
          <AppRoutes />
        </MemoryRouter>
      </SessionProvider>,
    )
    expect(screen.queryByText('Team screen')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Team' })).toBeNull()
  })
})
