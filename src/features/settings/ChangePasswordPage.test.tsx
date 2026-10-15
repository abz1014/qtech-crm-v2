import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import { ChangePasswordPage } from '@/features/settings/ChangePasswordPage'
import { passwordSchema } from '@/features/settings/passwordModel'
import { setSupabaseForTests, type Db } from '@/lib/supabase'
import { axeViolations } from '@/test/axe'
import { ToastProvider } from '@/ui/Toast'

const h = vi.hoisted(() => ({
  signIn: vi.fn(),
  update: vi.fn(),
  email: 'sales@test.invalid' as string | undefined,
}))

const fakeDb = {
  auth: {
    getSession: () => Promise.resolve({ data: { session: h.email ? { user: { email: h.email } } : null } }),
    signInWithPassword: h.signIn,
    updateUser: h.update,
  },
} as unknown as Db

const signedIn: SessionState = { status: 'signed-in', user: { id: 'u', name: 'Someone', role: 'sales' } }

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SessionProvider value={signedIn}>
        <MemoryRouter>
          <ToastProvider>
            <ChangePasswordPage />
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

async function fill(user: ReturnType<typeof userEvent.setup>, current: string, next: string, confirm: string) {
  await user.type(screen.getByLabelText('Current password'), current)
  await user.type(screen.getByLabelText('New password'), next)
  await user.type(screen.getByLabelText('Confirm new password'), confirm)
}

beforeEach(() => {
  setSupabaseForTests(fakeDb)
  h.email = 'sales@test.invalid'
  h.signIn.mockReset().mockResolvedValue({ error: null })
  h.update.mockReset().mockResolvedValue({ error: null })
})
afterEach(() => setSupabaseForTests(null))

describe('password rules', () => {
  const ok = { current: 'old-password-1', next: 'brand-new-passphrase', confirm: 'brand-new-passphrase' }
  it('accepts 12 or more characters that match', () => {
    expect(passwordSchema.safeParse(ok).success).toBe(true)
  })
  it('rejects under 12, a mismatch, a missing current and an unchanged password', () => {
    expect(passwordSchema.safeParse({ ...ok, next: 'short-11-xx', confirm: 'short-11-xx' }).success).toBe(false)
    expect(passwordSchema.safeParse({ ...ok, confirm: 'different-passphrase' }).success).toBe(false)
    expect(passwordSchema.safeParse({ ...ok, current: '' }).success).toBe(false)
    expect(passwordSchema.safeParse({ ...ok, current: ok.next }).success).toBe(false)
  })
})

describe('Change password screen', () => {
  it('re-authenticates with the current password, sets the new one and confirms with a toast', async () => {
    const user = userEvent.setup()
    mount()
    await fill(user, 'old-password-1', 'brand-new-passphrase', 'brand-new-passphrase')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ password: 'brand-new-passphrase' }))
    expect(h.signIn).toHaveBeenCalledWith({ email: 'sales@test.invalid', password: 'old-password-1' })
    expect(await screen.findByText('Password changed')).toBeInTheDocument()
    expect(screen.getByLabelText('Current password')).toHaveValue('')
  })

  it('a wrong current password is said plainly under that field and nothing is changed', async () => {
    h.signIn.mockResolvedValue({ error: { name: 'AuthApiError', message: 'Invalid login credentials' } })
    const user = userEvent.setup()
    mount()
    await fill(user, 'wrong-password-1', 'brand-new-passphrase', 'brand-new-passphrase')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument()
    expect(h.update).not.toHaveBeenCalled()
  })

  it('a new password under 12 characters is refused before any request', async () => {
    const user = userEvent.setup()
    mount()
    await fill(user, 'old-password-1', 'too-short', 'too-short')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findAllByText('Use at least 12 characters.')).not.toHaveLength(0)
    expect(h.signIn).not.toHaveBeenCalled()
  })

  it('a mismatched confirmation is refused before any request', async () => {
    const user = userEvent.setup()
    mount()
    await fill(user, 'old-password-1', 'brand-new-passphrase', 'brand-new-passphrasX')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findAllByText('The two new passwords do not match.')).not.toHaveLength(0)
    expect(h.signIn).not.toHaveBeenCalled()
  })

  it('a password the server calls weak is said plainly under the new password field', async () => {
    h.update.mockResolvedValue({ error: { name: 'AuthWeakPasswordError', code: 'weak_password', message: 'weak' } })
    const user = userEvent.setup()
    mount()
    await fill(user, 'old-password-1', 'brand-new-passphrase', 'brand-new-passphrase')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findAllByText(/too easy to guess/)).not.toHaveLength(0)
  })

  it('never writes a password to the page text or the console', async () => {
    const log = vi.spyOn(console, 'log')
    const err = vi.spyOn(console, 'error')
    const user = userEvent.setup()
    const { container } = mount()
    await fill(user, 'old-password-1', 'brand-new-passphrase', 'brand-new-passphrase')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    await screen.findByText('Password changed')
    expect(container.textContent).not.toContain('brand-new-passphrase')
    expect(JSON.stringify([...log.mock.calls, ...err.mock.calls])).not.toContain('passphrase')
    log.mockRestore()
    err.mockRestore()
  })

  it('has no axe violations', async () => {
    const { container } = mount()
    expect(await axeViolations(container)).toEqual([])
  })
})
