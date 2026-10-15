import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import { CategoriesPage } from '@/features/settings/CategoriesPage'
import type { Category } from '@/features/settings/categoriesModel'
import { ToastProvider } from '@/ui/Toast'
import { axeViolations } from '@/test/axe'

const h = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), create: vi.fn(), reorder: vi.fn(), del: vi.fn() }))
vi.mock('@/features/settings/api', () => ({
  listCategories: h.list,
  updateCategory: h.update,
  createCategory: h.create,
  reorderCategories: h.reorder,
  deleteCategory: h.del,
}))

const cat = (id: string, name: string, sort: number, over: Partial<Category> = {}): Category => ({
  id,
  name,
  grp: 'overhead',
  default_paid_via: 'bank',
  sort,
  active: true,
  used: 0,
  ...over,
})
const ROWS = [cat('rent', 'Rent', 10, { used: 14 }), cat('fuel', 'Fuel & travel', 20, { default_paid_via: 'cash', used: 3 }), cat('spare', 'Spare', 30), cat('old', 'Old thing', 40, { active: false, used: 2 })]

const me: SessionState = { status: 'signed-in', user: { id: 'bilal', name: 'Bilal Chaudhry', role: 'admin' } }
function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SessionProvider value={me}>
        <MemoryRouter>
          <ToastProvider>
            <CategoriesPage />
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  Object.values(h).forEach(f => f.mockReset())
  h.list.mockResolvedValue(ROWS)
  h.update.mockResolvedValue(undefined)
  h.create.mockResolvedValue(undefined)
  h.reorder.mockResolvedValue(undefined)
  h.del.mockResolvedValue(undefined)
})

const row = (name: string) => document.querySelector(`[data-category="${name}"]`) as HTMLElement

describe('Expense categories (M13)', () => {
  it('lists every category in order with its usage count, and marks the inactive one', async () => {
    mount()
    await screen.findByDisplayValue('Rent')
    const names = within(screen.getByRole('list', { name: 'Expense categories' })).getAllByRole('listitem').map(li => li.getAttribute('data-category'))
    expect(names).toEqual(['Rent', 'Fuel & travel', 'Spare', 'Old thing'])
    expect(within(row('Rent')).getByTestId('usage')).toHaveTextContent('14 uses')
    expect(within(row('Spare')).getByTestId('usage')).toHaveTextContent('Not used yet')
    expect(within(row('Old thing')).getByText(/hidden from new expenses/)).toBeInTheDocument()
    expect(screen.getByText('Categories in use cannot be deleted')).toBeInTheDocument()
  })

  it('ends with the count footer', async () => {
    mount()
    await screen.findByDisplayValue('Rent')
    expect(screen.getByTestId('categories-footer')).toHaveTextContent('4 categories · 3 active')
  })

  it('renames on Enter, trimmed', async () => {
    const user = userEvent.setup()
    mount()
    const input = await screen.findByLabelText('Name of Rent')
    await user.clear(input)
    await user.type(input, '  Office rent {Enter}')
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('rent', { name: 'Office rent' }))
  })

  it('refuses a name another category already has, without calling the server', async () => {
    const user = userEvent.setup()
    mount()
    const input = await screen.findByLabelText('Name of Rent')
    await user.clear(input)
    await user.type(input, 'fuel & travel{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
    expect(h.update).not.toHaveBeenCalled()
  })

  it('changes group and default paid via', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByDisplayValue('Rent')
    await user.selectOptions(screen.getByLabelText('Group of Rent'), 'order_cost')
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('rent', { grp: 'order_cost' }))
    await user.selectOptions(screen.getByLabelText('Default paid via for Rent'), 'cash')
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('rent', { default_paid_via: 'cash' }))
  })

  it('deactivates and reactivates with the checkbox', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByDisplayValue('Rent')
    await user.click(screen.getByRole('checkbox', { name: 'Rent is active' }))
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('rent', { active: false }))
    await user.click(screen.getByRole('checkbox', { name: 'Old thing is active' }))
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('old', { active: true }))
  })

  it('moves a category down and up by renumbering only what changes; the ends cannot move further', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByDisplayValue('Rent')
    expect(screen.getByRole('button', { name: 'Move Rent up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Old thing down' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Move Rent down' }))
    await waitFor(() =>
      expect(h.reorder).toHaveBeenCalledWith([
        { id: 'fuel', sort: 10 },
        { id: 'rent', sort: 20 },
      ]),
    )
    await user.click(screen.getByRole('button', { name: 'Move Spare up' }))
    await waitFor(() =>
      expect(h.reorder).toHaveBeenLastCalledWith([
        { id: 'spare', sort: 20 },
        { id: 'fuel', sort: 30 },
      ]),
    )
  })

  it('deleting a category in use is impossible: it says why and offers Deactivate', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByDisplayValue('Rent')
    await user.click(screen.getByRole('button', { name: 'Delete Rent' }))
    const panel = screen.getByRole('group', { name: 'Delete Rent' })
    expect(panel).toHaveTextContent('14 expenses and templates use "Rent", so it cannot be deleted. Deactivate it instead')
    expect(within(panel).queryByRole('button', { name: 'Delete' })).toBeNull()
    await user.click(within(panel).getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('rent', { active: false }))
    expect(h.del).not.toHaveBeenCalled()
  })

  it('an unused category can be deleted after a question', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByDisplayValue('Rent')
    await user.click(screen.getByRole('button', { name: 'Delete Spare' }))
    await user.click(within(screen.getByRole('group', { name: 'Delete Spare' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(h.del).toHaveBeenCalledWith('spare'))
  })

  it('if the database still refuses (used since the page loaded) the message says to deactivate', async () => {
    const user = userEvent.setup()
    h.del.mockRejectedValue({ code: '23503', message: 'update or delete on table "expense_categories" violates foreign key constraint', details: 'Key is still referenced from table "expenses".' })
    mount()
    await screen.findByDisplayValue('Rent')
    await user.click(screen.getByRole('button', { name: 'Delete Spare' }))
    await user.click(within(screen.getByRole('group', { name: 'Delete Spare' })).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('It is in use, so it cannot be deleted. Deactivate it instead.')).toBeInTheDocument()
  })

  it('adds a category at the end of the order', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByDisplayValue('Rent')
    await user.type(screen.getByLabelText('New category'), 'Insurance')
    await user.selectOptions(screen.getByLabelText('Paid via', { selector: 'select' }), 'cash')
    await user.click(screen.getByRole('button', { name: 'Add category' }))
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({ name: 'Insurance', grp: 'overhead', default_paid_via: 'cash', sort: 50 }))
  })

  it('has no accessibility violations', async () => {
    const { container } = mount()
    await screen.findByDisplayValue('Rent')
    expect(await axeViolations(container)).toEqual([])
  })
})
