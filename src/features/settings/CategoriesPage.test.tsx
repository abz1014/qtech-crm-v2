import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import { CategoriesPage } from '@/features/settings/CategoriesPage'
import type { Category, ExpenseGroup } from '@/features/settings/categoriesModel'
import { ToastProvider } from '@/ui/Toast'
import { axeViolations } from '@/test/axe'

const h = vi.hoisted(() => ({
  list: vi.fn(),
  groups: vi.fn(),
  totals: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  reorder: vi.fn(),
  del: vi.fn(),
  merge: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
}))
vi.mock('@/features/settings/api', () => ({
  listCategories: h.list,
  listGroups: h.groups,
  categoryMonthTotals: h.totals,
  updateCategory: h.update,
  createCategory: h.create,
  reorderCategories: h.reorder,
  deleteCategory: h.del,
  mergeCategories: h.merge,
  createGroup: h.createGroup,
  updateGroup: h.updateGroup,
  deleteGroup: h.deleteGroup,
}))

const g = (id: string, name: string, kind: ExpenseGroup['kind'], sort: number): ExpenseGroup => ({ id, name, kind, sort })
const GROUPS = [g('office', 'Office running', 'overhead', 10), g('cars', 'Vehicles', 'overhead', 20), g('orders', 'Order costs', 'order_cost', 50), g('empty', 'Site visits', 'overhead', 70)]
const cat = (id: string, name: string, sort: number, over: Partial<Category> = {}): Category => ({
  id,
  name,
  grp: 'overhead',
  default_paid_via: 'bank',
  sort,
  active: true,
  used: 0,
  group_id: 'office',
  monthly_budget_pkr: null,
  ...over,
})
const ROWS = [
  cat('rent', 'Rent', 10, { used: 14 }),
  cat('water', 'Water', 20, { default_paid_via: 'cash', used: 13, monthly_budget_pkr: 3000 }),
  cat('spare', 'Spare', 30),
  cat('fuel', 'Fuel & travel', 10, { group_id: 'cars', default_paid_via: 'cash', used: 3, monthly_budget_pkr: 20000 }),
  cat('freight', 'Freight', 10, { group_id: 'orders', grp: 'order_cost', used: 6 }),
  cat('old', 'Old thing', 40, { active: false, used: 2 }),
]
const TOTALS = { rent: 85000, water: 2800, fuel: 23360, freight: 42000 }

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
  h.groups.mockResolvedValue(GROUPS)
  h.totals.mockResolvedValue(TOTALS)
  h.update.mockResolvedValue(undefined)
  h.create.mockResolvedValue('new-cat')
  h.reorder.mockResolvedValue(undefined)
  h.del.mockResolvedValue(undefined)
  h.merge.mockResolvedValue(13)
  h.createGroup.mockResolvedValue('new-group')
  h.updateGroup.mockResolvedValue(undefined)
  h.deleteGroup.mockResolvedValue(undefined)
})

const row = (name: string) => document.querySelector(`[data-category="${name}"]`) as HTMLElement
const loaded = () => screen.findByText('Rent')
async function menu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: `More for ${name}` }))
  return screen.getByRole('menu', { name: `More for ${name}` })
}
const items = (m: HTMLElement) => [...m.querySelectorAll('[role^="menuitem"]')].map(i => i.textContent)

describe('Expense categories (M13, 0084)', () => {
  it('lists the groups in order, each with its categories, this month and the budget left or over', async () => {
    mount()
    await loaded()
    const sections = [...document.querySelectorAll('[data-group]')].map(s => s.getAttribute('data-group'))
    expect(sections).toEqual(['Office running', 'Vehicles', 'Order costs', 'Site visits'])
    const office = within(document.querySelector('[data-group="Office running"]') as HTMLElement)
    expect(office.getAllByRole('listitem').map(li => li.getAttribute('data-category'))).toEqual(['Rent', 'Water', 'Spare'])
    expect(office.getByTestId('group-total')).toHaveTextContent('PKR 87,800')
    expect(office.getByText('Running costs')).toBeInTheDocument()
    // a group named after its kind does not repeat it
    expect(within(document.querySelector('[data-group="Order costs"]') as HTMLElement).queryAllByText('Order costs')).toHaveLength(1)
    expect(within(row('Water')).getByTestId('usage')).toHaveTextContent('Usually cash · 13 uses')
    expect(within(row('Water')).getByTestId('spent')).toHaveTextContent('2,800')
    expect(within(row('Water')).getByTestId('budget')).toHaveTextContent('200 left of 3,000')
    expect(within(row('Fuel & travel')).getByTestId('budget')).toHaveTextContent('3,360 over budget')
    expect(within(row('Spare')).getByTestId('usage')).toHaveTextContent('Not used yet')
    expect(within(row('Spare')).getByTestId('spent')).toHaveTextContent('—')
    // the empty group says so and offers to add one
    expect(within(document.querySelector('[data-group="Site visits"]') as HTMLElement).getByText('No categories yet.')).toBeInTheDocument()
    // the archived one waits, collapsed, at the foot
    expect(screen.getByText(/Archived \(1\)/)).toBeInTheDocument()
    expect(screen.queryAllByRole('textbox')).toHaveLength(0) // read-only rows: nothing to type into until a dialog opens
    expect(screen.getByTestId('categories-footer')).toHaveTextContent('6 categories · 1 archived · 4 groups')
  })

  it('reads the month totals for the current month only', async () => {
    mount()
    await loaded()
    expect(h.totals).toHaveBeenCalledTimes(1)
    expect(h.totals.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}$/)
  })

  it('a used category offers Archive and Merge but never Delete; an unused one offers Delete', async () => {
    const user = userEvent.setup()
    mount()
    await loaded()
    const m = await menu(user, 'Rent')
    expect(items(m)).toEqual([
      'Rename',
      'Move to group…',
      'Set monthly budget…',
      'Usually paid by cash',
      'Usually paid by bank',
      'Move down',
      'Merge into…',
      'Archive',
    ])
    await user.keyboard('{Escape}')
    const s = await menu(user, 'Spare')
    expect(items(s)).toContain('Delete')
    await user.click(within(s).getByRole('menuitem', { name: 'Delete' }))
    const dlg = await screen.findByRole('dialog', { name: 'Delete Spare?' })
    await user.click(within(dlg).getByRole('button', { name: 'Delete category' }))
    await waitFor(() => expect(h.del).toHaveBeenCalledWith('spare'))
  })

  it('renames in a dialog, trimmed; a name another category has is refused without a request', async () => {
    const user = userEvent.setup()
    mount()
    await loaded()
    await user.click(within(await menu(user, 'Rent')).getByRole('menuitem', { name: 'Rename' }))
    const dlg = await screen.findByRole('dialog', { name: 'Rename Rent' })
    const input = within(dlg).getByLabelText('Name')
    await user.clear(input)
    await user.type(input, 'water{Enter}')
    expect(await within(dlg).findByText('A category with this name already exists.')).toBeInTheDocument()
    expect(h.update).not.toHaveBeenCalled()
    await user.clear(input)
    await user.type(input, '  Office   rent {Enter}')
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('rent', { name: 'Office rent' }))
  })

  it('changes the usual payment in one choice', async () => {
    const user = userEvent.setup()
    mount()
    await loaded()
    await user.click(within(await menu(user, 'Rent')).getByRole('menuitemradio', { name: 'Usually paid by cash' }))
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('rent', { default_paid_via: 'cash' }))
  })

  it('archives with an Undo, and brings an archived one back', async () => {
    const user = userEvent.setup()
    mount()
    await loaded()
    await user.click(within(await menu(user, 'Water')).getByRole('menuitem', { name: 'Archive' }))
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('water', { active: false }))
    await user.click(await screen.findByRole('button', { name: /Undo/ }))
    await waitFor(() => expect(h.update).toHaveBeenLastCalledWith('water', { active: true }))
    await user.click(screen.getByText(/Archived \(1\)/))
    const m = await menu(user, 'Old thing')
    expect(items(m)).not.toContain('Delete') // used twice
    await user.click(within(m).getByRole('menuitem', { name: 'Bring back' }))
    await waitFor(() => expect(h.update).toHaveBeenLastCalledWith('old', { active: true }))
  })

  it('merges into a category of the same kind first, saying how many records move', async () => {
    const user = userEvent.setup()
    mount()
    await loaded()
    await user.click(within(await menu(user, 'Water')).getByRole('menuitem', { name: 'Merge into…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Merge Water' })
    const select = within(dlg).getByLabelText('Merge into') as HTMLSelectElement
    expect([...select.options].map(o => o.text)).toEqual(['Rent (Office running)', 'Spare (Office running)', 'Fuel & travel (Vehicles)', 'Freight (Order costs), order costs'])
    expect(within(dlg).getByTestId('merge-summary')).toHaveTextContent('Moves 13 expenses and templates from "Water" into "Rent". "Water" is removed.')
    await user.selectOptions(select, 'freight')
    expect(within(dlg).getByText('This changes Profit and loss')).toBeInTheDocument()
    await user.selectOptions(select, 'spare')
    await user.click(within(dlg).getByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(h.merge).toHaveBeenCalledWith('water', 'spare'))
    expect(await screen.findByText('13 expenses moved from Water into Spare')).toBeInTheDocument()
  })

  it('a refused merge stays open with the server sentence', async () => {
    const user = userEvent.setup()
    h.merge.mockRejectedValue({
      code: '23514',
      message: '"Water" has expenses in September 2026 and that month is closed. Merging it into a category of another kind would change that month\'s profit. Pick a category of the same kind, or reopen the month first.',
    })
    mount()
    await loaded()
    await user.click(within(await menu(user, 'Water')).getByRole('menuitem', { name: 'Merge into…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Merge Water' })
    await user.selectOptions(within(dlg).getByLabelText('Merge into'), 'freight')
    await user.click(within(dlg).getByRole('button', { name: 'Merge' }))
    expect(await within(dlg).findByText(/that month is closed/)).toBeInTheDocument()
  })

  it('moves to a group of another kind only after saying what changes in Profit and loss', async () => {
    const user = userEvent.setup()
    mount()
    await loaded()
    await user.click(within(await menu(user, 'Rent')).getByRole('menuitem', { name: 'Move to group…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Move Rent' })
    expect(within(dlg).queryByText('This changes Profit and loss')).toBeNull()
    await user.selectOptions(within(dlg).getByLabelText('Group'), 'orders')
    expect(within(dlg).getByText(/count as an order cost, not a running cost/)).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('rent', { group_id: 'orders', sort: 20 }))
  })

  it('sets a monthly budget, and an emptied budget removes it', async () => {
    const user = userEvent.setup()
    mount()
    await loaded()
    await user.click(within(await menu(user, 'Rent')).getByRole('menuitem', { name: 'Set monthly budget…' }))
    let dlg = await screen.findByRole('dialog', { name: 'Monthly budget for Rent' })
    await user.type(within(dlg).getByLabelText('Budget a month, PKR'), '90000')
    await user.click(within(dlg).getByRole('button', { name: 'Save budget' }))
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('rent', { monthly_budget_pkr: 90000 }))
    await user.click(within(await menu(user, 'Water')).getByRole('menuitem', { name: 'Change monthly budget…' }))
    dlg = await screen.findByRole('dialog', { name: 'Monthly budget for Water' })
    await user.clear(within(dlg).getByLabelText('Budget a month, PKR'))
    await user.click(within(dlg).getByRole('button', { name: 'Remove budget' }))
    await waitFor(() => expect(h.update).toHaveBeenLastCalledWith('water', { monthly_budget_pkr: null }))
  })

  it('adds a category last in its group, and can make a new group on the way', async () => {
    const user = userEvent.setup()
    mount()
    await loaded()
    await user.click(screen.getByRole('button', { name: 'Add category' }))
    let dlg = await screen.findByRole('dialog', { name: 'Add category' })
    await user.type(within(dlg).getByLabelText('Name'), 'Insurance')
    await user.click(within(dlg).getByRole('radio', { name: 'Bank' }))
    await user.click(within(dlg).getByRole('button', { name: 'Add category' }))
    await waitFor(() =>
      expect(h.create).toHaveBeenCalledWith({ name: 'Insurance', group_id: 'office', grp: 'overhead', default_paid_via: 'bank', sort: 50, monthly_budget_pkr: null }),
    )
    await user.click(screen.getByRole('button', { name: 'Add category' }))
    dlg = await screen.findByRole('dialog', { name: 'Add category' })
    await user.type(within(dlg).getByLabelText('Name'), 'Generator diesel')
    await user.selectOptions(within(dlg).getByLabelText('Group'), '__new__')
    await user.type(within(dlg).getByLabelText('New group name'), 'Generator')
    await user.type(within(dlg).getByLabelText('Monthly budget, PKR'), '15000')
    await user.click(within(dlg).getByRole('button', { name: 'Add category' }))
    await waitFor(() => expect(h.createGroup).toHaveBeenCalledWith({ name: 'Generator', kind: 'overhead', sort: 80 }))
    await waitFor(() =>
      expect(h.create).toHaveBeenLastCalledWith({ name: 'Generator diesel', group_id: 'new-group', grp: 'overhead', default_paid_via: 'cash', sort: 50, monthly_budget_pkr: 15000 }),
    )
  })

  it('a group can be renamed, and deleted only when it holds nothing', async () => {
    const user = userEvent.setup()
    mount()
    await loaded()
    const office = await menu(user, 'the group Office running')
    expect(items(office)).toEqual(['Add a category here', 'Rename group'])
    await user.keyboard('{Escape}')
    const empty = await menu(user, 'the group Site visits')
    await user.click(within(empty).getByRole('menuitem', { name: 'Delete group' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Delete Site visits?' })).getByRole('button', { name: 'Delete group' }))
    await waitFor(() => expect(h.deleteGroup).toHaveBeenCalledWith('empty'))
  })

  it('moves a category within its group, renumbering only that group', async () => {
    const user = userEvent.setup()
    mount()
    await loaded()
    await user.click(within(await menu(user, 'Water')).getByRole('menuitem', { name: 'Move up' }))
    await waitFor(() =>
      expect(h.reorder).toHaveBeenCalledWith([
        { id: 'water', sort: 10 },
        { id: 'rent', sort: 20 },
      ]),
    )
  })

  it('has no accessibility violations', async () => {
    const { container } = mount()
    await loaded()
    expect(await axeViolations(container)).toEqual([])
  })
})
