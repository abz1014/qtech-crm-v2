import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { workSentence } from './api'
import { ReassignWorkDialog } from './ReassignDialogs'
import { ToastProvider } from '@/ui/Toast'

const calls: string[] = []
vi.mock('./api', async orig => {
  const real = await orig<typeof import('./api')>()
  return {
    ...real,
    listOwnerCandidates: async () => [
      { id: 'u-sales', name: 'Sana Sales', role: 'sales' },
      { id: 'u-new', name: 'Nida New', role: 'sales' },
    ],
    openWorkOf: async () => ({ rfqs: 2, orders: 1 }),
    reassignOpenWork: async (from: string, to: string) => {
      calls.push(`${from}>${to}`)
      return { rfqs: 2, orders: 1 }
    },
  }
})

describe('reassign owner (process audit 1)', () => {
  it('says the open work in words', () => {
    expect(workSentence({ rfqs: 0, orders: 0 })).toBe('no open work')
    expect(workSentence({ rfqs: 1, orders: 0 })).toBe('1 open enquiry')
    expect(workSentence({ rfqs: 2, orders: 3 })).toBe('2 open enquiries and 3 live orders')
  })

  it('moves all of a leaver\'s open work to the person chosen, and not to the leaver', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ReassignWorkDialog fromId="u-sales" fromName="Sana Sales" onClose={onClose} />
        </ToastProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Sana Sales has 2 open enquiries and 1 live order.')).toBeInTheDocument()
    const pick = await screen.findByLabelText('New owner')
    expect(screen.queryByRole('option', { name: 'Sana Sales' })).toBeNull()
    const go = screen.getByRole('button', { name: 'Move it all' })
    expect(go).toBeDisabled()
    await user.selectOptions(pick, 'u-new')
    await user.click(go)
    await vi.waitFor(() => expect(calls).toEqual(['u-sales>u-new']))
  })
})
