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
const ROWS = [
  cat('rent', 'Rent', 10, { used: 14 }),
  cat('fuel', 'Fuel & travel', 20, { default_paid_via: 'cash', used: 3 }),
  cat('freight', 'Freight', 25, { grp: 'order_cost', used: 1 }),
  cat('spare', 'Spare', 30),
  cat('old', 'Old thing', 40, { active: false, used: 2 }),
]

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
const names = (section: string) =>
  within(screen.getByRole('list', { name: section }))
    .getAllByRole('listitem')
    .map(li => li.getAttribute('data-category'))
const menu = async (user: ReturnType<typeof userEvent.setup>, name: string, item: string) => {
  await user.click(screen.getByRole('button', { name: `More for ${name}` }))
  await user.click(await screen.findByRole('menuitem', { name: item }))
}

describe('Expense categories (M13)', () => {
  it('lists the categories read-only, in sections by group, in order, with paid via and usage, and marks the inactive one', async () => {
    mount()
    await screen.findByText('Rent')
    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['Overheads', 'Order costs'])
    expect(names('Overheads')).toEqual(['Rent', 'Fuel & travel', 'Spare', 'Old thing'])
    expect(names('Order costs')).toEqual(['Freight'])
    expect(within(row('Rent')).getByTestId('usage')).toHaveTextContent('14 uses')
    expect(row('Fuel & travel')).toHaveTextContent('Paid via cash')
    expect(within(row('Spare')).getByTestId('usage')).toHaveTextContent('Not used yet')
    expect(within(row('Old thing')).getByText(/hidden from new expenses/)).toBeInTheDocument()
    // read-only rows: no inputs until Edit; the rule behind Delete is in the (i), not a banner
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByText('Categories in use cannot be deleted')).toBeNull()
  })

  it('shows Delete only on a category nothing uses', async () => {
    mount()
    await screen.findByText('Rent')
    expect(screen.getByRole('button', { name: 'Delete Spare' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Rent' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete Old thing' })).toBeNull()
  })

  it('ends with the count footer', async () => {
    mount()
    await screen.findByText('Rent')
    expect(screen.getByTestId('categories-footer')).toHaveTextContent('5 categories · 4 active')
  })

  it('renames from Edit, trimmed, saving only what changed', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Rent')
    await menu(user, 'Rent', 'Edit name, group or paid via')
    const input = screen.getByLabelText('Name')
    await user.clear(input)
    await user.type(input, '  Office rent ')
    await user.click(screen.getByRole('button', { name: 'Save category' }))
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('rent', { name: 'Office rent' }))
  })

  it('refuses a name another category already has, without calling the server', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Rent')
    await menu(user, 'Rent', 'Edit name, group or paid via')
    const input = screen.getByLabelText('Name')
    await user.clear(input)
    await user.type(input, 'fuel & travel{Enter}')
    expect(await screen.findByText('A category with this name already exists.')).toBeInTheDocument()
    expect(h.update).not.toHaveBeenCalled()
  })

  it('changes group and default paid via in one save', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Rent')
    await menu(user, 'Rent', 'Edit name, group or paid via')
    await user.selectOptions(screen.getByLabelText('Group'), 'order_cost')
    await user.selectOptions(screen.getByLabelText('Paid via'), 'cash')
    await user.click(screen.getByRole('button', { name: 'Save category' }))
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('rent', { grp: 'order_cost', default_paid_via: 'cash' }))
  })

  it('deactivates and reactivates from the row menu', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Rent')
    await menu(user, 'Rent', 'Deactivate')
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('rent', { active: false }))
    await menu(user, 'Old thing', 'Reactivate')
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('old', { active: true }))
  })

  it('moves a category within its group, renumbering only what changes; the ends of a group cannot move further', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Rent')
    await user.click(screen.getByRole('button', { name: 'More for Rent' }))
    expect(await screen.findByRole('menuitem', { name: 'Move up' })).toBeDisabled()
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }))
    await waitFor(() =>
      expect(h.reorder).toHaveBeenCalledWith([
        { id: 'fuel', sort: 10 },
        { id: 'rent', sort: 20 },
        { id: 'freight', sort: 30 },
        { id: 'spare', sort: 40 },
        { id: 'old', sort: 50 },
      ]),
    )
    // Spare up: it passes Freight (another group) and swaps with Fuel & travel
    await menu(user, 'Spare', 'Move up')
    await waitFor(() =>
      expect(h.reorder).toHaveBeenLastCalledWith([
        { id: 'spare', sort: 20 },
        { id: 'freight', sort: 30 },
        { id: 'fuel', sort: 40 },
        { id: 'old', sort: 50 },
      ]),
    )
  })

  it('an unused category can be deleted after a question', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Rent')
    await user.click(screen.getByRole('button', { name: 'Delete Spare' }))
    const panel = screen.getByRole('group', { name: 'Delete Spare' })
    expect(panel).toHaveTextContent('Nothing uses it')
    await user.click(within(panel).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(h.del).toHaveBeenCalledWith('spare'))
  })

  it('if the database still refuses (used since the page loaded) the message says to deactivate', async () => {
    const user = userEvent.setup()
    h.del.mockRejectedValue({ code: '23503', message: 'update or delete on table "expense_categories" violates foreign key constraint', details: 'Key is still referenced from table "expenses".' })
    mount()
    await screen.findByText('Rent')
    await user.click(screen.getByRole('button', { name: 'Delete Spare' }))
    await user.click(within(screen.getByRole('group', { name: 'Delete Spare' })).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('It is in use, so it cannot be deleted. Deactivate it instead.')).toBeInTheDocument()
  })

  it('adds a category at the end of the order, behind the one green Add category button', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Rent')
    expect(screen.queryByLabelText('Name')).toBeNull() // no form on the page until asked for
    await user.click(screen.getByRole('button', { name: 'Add category' }))
    await user.type(screen.getByLabelText('Name'), 'Insurance')
    await user.selectOptions(screen.getByLabelText('Paid via'), 'cash')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add category' }))
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({ name: 'Insurance', grp: 'overhead', default_paid_via: 'cash', sort: 50 }))
  })

  it('has no accessibility violations', async () => {
    const { container } = mount()
    await screen.findByText('Rent')
    expect(await axeViolations(container)).toEqual([])
  })
})