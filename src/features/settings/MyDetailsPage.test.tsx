import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import { MyDetailsPage } from '@/features/settings/MyDetailsPage'
import { setSupabaseForTests, type Db } from '@/lib/supabase'
import { ToastProvider } from '@/ui/Toast'
import { axeViolations } from '@/test/axe'

const h = vi.hoisted(() => ({ row: null as unknown, update: vi.fn(), updated: [] as unknown[] }))

const fakeDb = {
  from: () => ({
    select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: h.row, error: null }) }) }),
    update: (patch: unknown) => {
      h.update(patch)
      return { eq: () => ({ select: () => Promise.resolve({ data: h.updated, error: null }) }) }
    },
  }),
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { email: 'ayesha@qtech.example' } } } }) },
} as unknown as Db

const me: SessionState = { status: 'signed-in', user: { id: 'ayesha', name: 'Ayesha Rana', role: 'sales' } }

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SessionProvider value={me}>
        <MemoryRouter>
          <ToastProvider>
            <div data-testid="page">
              <MyDetailsPage />
            </div>
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  setSupabaseForTests(fakeDb)
  h.row = { id: 'ayesha', name: 'Ayesha Rana', job_title: 'Sales engineer', phone: null }
  h.update.mockReset()
  h.updated = [{ id: 'ayesha', phone: '0300 1234567' }]
})
afterEach(() => setSupabaseForTests(null))

describe('Your details screen', () => {
  it('shows name, email and job title read only, with the phone editable', async () => {
    mount()
    expect(await screen.findByLabelText('Name')).toHaveValue('Ayesha Rana')
    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Email')).toHaveValue('ayesha@qtech.example')
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Job title')).toHaveValue('Sales engineer')
    expect(screen.getByText('Set by an admin')).toBeInTheDocument()
    expect(screen.getByLabelText(/Phone/)).not.toHaveAttribute('readonly')
    expect(screen.getByLabelText(/Phone/)).toHaveClass('num')
    expect(screen.getByText('Nothing to save yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('saves the phone to the users row and confirms', async () => {
    const user = userEvent.setup()
    mount()
    await user.type(await screen.findByLabelText(/Phone/), '0300 1234567')
    expect(screen.getByText('1 unsaved change: Phone')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ phone: '0300 1234567' }))
    expect(await screen.findByText('Phone saved')).toBeInTheDocument()
    expect(screen.getByText('Nothing to save yet')).toBeInTheDocument()
  })

  it('has no accessibility violations', async () => {
    mount()
    await screen.findByLabelText('Name')
    expect(await axeViolations(screen.getByTestId('page'))).toEqual([])
  })
})
