import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SignInPage } from '@/app/pages/SignInPage'

vi.mock('@/lib/supabase', () => ({ getSupabase: () => null }))

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

afterEach(() => vi.restoreAllMocks())

describe('sign-in offline (phone audit 2c)', () => {
  it('offline: says to sign in again when there is signal, and offers no form that cannot work', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    mount()
    expect(screen.getByRole('heading', { name: 'You’re offline' })).toBeInTheDocument()
    expect(screen.getByText(/Sign in again when you have signal/)).toBeInTheDocument()
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
