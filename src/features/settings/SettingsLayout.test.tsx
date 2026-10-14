import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from '@/app/routes'
import { SessionProvider } from '@/app/SessionProvider'
import { AdminOnly, SettingsHome, SettingsLayout } from '@/features/settings/SettingsLayout'

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
            <Route path="company" element={<p>Company screen</p>} />
          </Route>
          <Route path="/no-access" element={null} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  )
}

describe('settings access (A04, A06)', () => {
  it('/settings opens Team for an admin and the company profile for everyone else', () => {
    at('/settings', 'admin')
    expect(screen.getByText('Team screen')).toBeInTheDocument()
  })

  for (const role of ['sales', 'engineer']) {
    it(`${role}: Team is not offered and a typed /settings/team address shows the no-access page`, () => {
      const first = at('/settings', role)
      expect(screen.getByText('Company screen')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Team' })).toBeNull()
      expect(screen.getByRole('link', { name: 'Company profile' })).toBeInTheDocument()
      first.unmount()

      at('/settings/team', role)
      expect(screen.queryByText('Team screen')).toBeNull()
      expect(screen.getByText('Team is not available to your role')).toBeInTheDocument()
    })
  }

  it('an admin sees both links', () => {
    at('/settings/company', 'admin')
    expect(screen.getByRole('link', { name: 'Team' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Company profile' })).toBeInTheDocument()
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
