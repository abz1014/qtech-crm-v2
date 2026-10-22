import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import { qk } from '@/features/queryKeys'
import type { RfqHeader } from '@/features/rfqs/api'
import { ClarificationsPanel } from '@/features/rfqs/ClarificationsPanel'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/*
 * The customer chase text in "Questions for the customer" (R09) must follow the questions it is written from: after a chase is
 * stamped (ask_count goes up) the next message is the firmer one, not the same gentle reminder again.
 */

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

const rfq: RfqHeader = {
  id: 'r-1',
  number: 185,
  customerRef: null,
  receivedOn: '2026-10-01',
  dueOn: null,
  isPriority: false,
  quotedOn: null,
  closedOn: null,
  closeReason: null,
  closeNote: null,
  notes: null,
  company: { id: 'c-1', name: 'Acme Plastics', country: 'Pakistan', createdAt: null },
  site: null,
  contactId: null,
  contact: { name: 'Kamran', phone: null },
  owner: null,
  state: null,
}

const yesterday = new Date(Date.now() - 86_400_000).toISOString()

function question(askCount: number) {
  return {
    id: 'q-1',
    question: 'What flange size?',
    raised_by_inquiry_id: null,
    rfq_item_id: null,
    first_asked_at: yesterday,
    last_asked_at: yesterday,
    last_asked_by: 'u1',
    ask_count: askCount,
    answer: null,
    answered_at: null,
    withdrawn_at: null,
    created_at: yesterday,
  }
}

describe('ClarificationsPanel chase text', () => {
  it('rewrites the chase text when the ask count of the same questions goes up', async () => {
    let askCount = 1
    installFakeDb((call: FakeCall) => (call.target === 'clarifications' ? { data: [question(askCount)] } : { data: [] }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role: 'sales' } }}>
          <MemoryRouter>
            <ToastProvider>
              <ClarificationsPanel rfq={rfq} inquiries={[]} />
            </ToastProvider>
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    )
    // The message waits under "Show the whole message": the questions are listed right above it.
    expect(screen.queryByTestId('chase-text')).toBeNull()
    const user = userEvent.setup()
    expect(await screen.findByRole('button', { name: 'Copy chase text' })).toBeInTheDocument() // wider screens: the card shows
    expect(screen.queryByRole('button', { name: 'Email instead' })).toBeNull() // the other channel waits with the whole message
    await user.click(screen.getByRole('button', { name: 'Show the whole message' }))
    expect(screen.getByRole('button', { name: 'Email instead' })).toBeInTheDocument()
    const text = await screen.findByTestId('chase-text')
    expect(text.textContent).toMatch(/gentle reminder/)

    // The chase was stamped (by this tab or another): the same question now reads ask_count 2.
    askCount = 2
    await act(() => client.invalidateQueries({ queryKey: qk.rfqs.part('r-1', 'clarifications') }))
    await waitFor(() => expect(screen.getByTestId('chase-text').textContent).toMatch(/once more/))
  })
})

describe('ClarificationsPanel copy and mark asked', () => {
  it('a double tap on Copy chase text stamps the questions once, not twice', async () => {
    const stamps: FakeCall[] = []
    installFakeDb((call: FakeCall) => {
      if (call.target === 'rpc:stamp_clarification_ask') {
        stamps.push(call)
        return { data: 1 }
      }
      return call.target === 'clarifications' ? { data: [question(1)] } : { data: [] }
    })
    const user = userEvent.setup()
    let release: () => void = () => undefined
    const held = new Promise<void>(r => (release = r))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => held } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role: 'sales' } }}>
          <MemoryRouter>
            <ToastProvider>
              <ClarificationsPanel rfq={rfq} inquiries={[]} />
            </ToastProvider>
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    )
    await user.dblClick(await screen.findByRole('button', { name: 'Copy chase text' }))
    release()
    await waitFor(() => expect(screen.getAllByText('Chase text copied').length).toBeGreaterThan(0))
    expect(stamps).toHaveLength(1)
  })
})

describe('ClarificationsPanel on a phone (grade-A 6 fix 2)', () => {
  it('questions waiting on the customer show one "Chase the customer" button that opens the card', async () => {
    const orig = window.matchMedia
    window.matchMedia = ((q: string) => ({
      matches: q === '(max-width: 767px)',
      media: q,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia
    try {
      installFakeDb((call: FakeCall) => (call.target === 'clarifications' ? { data: [question(1)] } : { data: [] }))
      const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
      render(
        <QueryClientProvider client={client}>
          <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role: 'sales' } }}>
            <MemoryRouter>
              <ToastProvider>
                <ClarificationsPanel rfq={rfq} inquiries={[]} />
              </ToastProvider>
            </MemoryRouter>
          </SessionContext.Provider>
        </QueryClientProvider>,
      )
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: 'Chase the customer' }))
      expect(screen.getByRole('button', { name: 'Copy chase text' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Chase the customer' })).toBeNull()
    } finally {
      window.matchMedia = orig
    }
  })
})
