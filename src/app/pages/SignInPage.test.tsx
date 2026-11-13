import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SignInPage } from '@/app/pages/SignInPage'

vi.mock('@/lib/supabase', () => ({ getSupabase: () => null }))
let keptItems: unknown[] = []
vi.mock('@/lib/capture/store', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/capture/store')>()
  return { ...real, listCaptures: () => Promise.resolve(keptItems), markCaptureBeforeSignIn: vi.fn() }
})

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SignInPage />
    </QueryClientProvider>,
  )
}

const setOnline = (on: boolean) => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(on)
  window.dispatchEvent(new Event(on ? 'online' : 'offline'))
}

afterEach(() => {
  vi.restoreAllMocks()
  keptItems = []
})

describe('sign-in offline (phone audit 2c)', () => {
  it('offline: says to sign in again when there is signal, and offers no form that cannot work', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    mount()
    expect(screen.getByRole('heading', { name: 'No connection' })).toBeInTheDocument()
    expect(screen.getByText(/Sign in again when the connection returns/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).toBeNull()
  })

  it('turns into the sign-in form by itself when signal returns', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    mount()
    await act(async () => setOnline(true))
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
})

describe('sign-in with a kept shared item (live bug 15)', () => {
  it('names the Shared with Q-Tech CRM page, not a Capture sheet', async () => {
    keptItems = [{ id: 'k', source: 'share', text: 'hello', files: [], createdAt: 0, expiresAt: Date.UTC(2026, 10, 20) }]
    mount()
    const online = await screen.findByText(/Sign in and the Shared with Q-Tech CRM page opens with it\./)
    expect(online).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Capture sheet/)
    await act(async () => setOnline(false))
    expect(await screen.findByText(/the Shared with Q-Tech CRM page opens with it\./)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Capture sheet/)
  })
})
