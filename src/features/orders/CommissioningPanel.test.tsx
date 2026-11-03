import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { installFakeDb } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'
import type { OrderHeader } from '@/features/orders/api'
import { CommissioningPanel, ENGINEER_NOTES_HINT } from '@/features/orders/CommissioningPanel'

const order = { id: 'o-1', updatedAt: 'T1', number: 1, companyName: 'Test Co', needsCommissioning: false, doneOn: null, notes: 'Gate pass at 3pm', contact: null } as unknown as OrderHeader

function mount(isEngineer: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <CommissioningPanel order={order} engineers={[]} isEngineer={isEngineer} canEdit={!isEngineer} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('Commissioning panel: order notes', () => {
  it('tells an engineer how to add a note, and does not say the notes are read only', () => {
    mount(true)
    expect(screen.getByText(ENGINEER_NOTES_HINT)).toBeInTheDocument()
    expect(screen.queryByText(/read only/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit notes' })).toBeNull()
    expect(screen.getByTestId('order-notes')).toHaveTextContent('Gate pass at 3pm')
  })
  it('admin and sales keep Edit notes', () => {
    mount(false)
    expect(screen.getByRole('button', { name: 'Edit notes' })).toBeInTheDocument()
    expect(screen.queryByText(ENGINEER_NOTES_HINT)).toBeNull()
  })
})

describe('Commissioning panel: someone else changed the order', () => {
  afterEach(() => installFakeDb(() => ({})).uninstall())
  it('says so in plain words and keeps what was typed', async () => {
    installFakeDb(() => ({ data: [] })) // the conditional write matches no row: the order moved on
    const user = userEvent.setup()
    mount(false)
    await user.click(screen.getByRole('button', { name: 'Edit notes' }))
    const box = screen.getByRole('textbox', { name: 'Order notes' })
    await user.clear(box)
    await user.type(box, 'Bring the long ladder')
    await user.click(screen.getByRole('button', { name: 'Save notes' }))
    expect(await screen.findByText('Someone else changed this order. Reload to see their changes.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Order notes' })).toHaveValue('Bring the long ladder')
  })
})
