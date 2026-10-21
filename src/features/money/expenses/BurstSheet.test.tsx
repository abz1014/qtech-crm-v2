import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { BurstSheet } from '@/features/money/expenses/BurstSheet'
import { installFakeDb, opArgs, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

const CATEGORIES = [
  { id: 'c-snacks', name: 'Office supplies & snacks', grp: 'overhead', default_paid_via: 'cash', sort: 50, active: true },
  { id: 'c-fuel', name: 'Fuel & travel', grp: 'overhead', default_paid_via: 'cash', sort: 40, active: true },
  { id: 'c-sal', name: 'Salaries', grp: 'overhead', default_paid_via: 'bank', sort: 10, active: true },
]

function setup(upsert: () => FakeResult | Promise<FakeResult> = () => ({})) {
  const db = installFakeDb((c: FakeCall) => {
    if (c.target === 'expense_categories') return { data: CATEGORIES }
    if (c.target === 'expenses' && c.verb === 'select')
      return { data: [{ category_id: 'c-snacks', paid_on: '2026-11-01' }, { category_id: 'c-snacks', paid_on: '2026-11-02' }, { category_id: 'c-fuel', paid_on: '2026-11-03' }] }
    if (c.target === 'expenses' && c.verb === 'upsert') return upsert()
    if (c.target === 'orders') return { data: [{ id: 'o-42', number: 42, company_id: 'co-1' }, { id: 'o-7', number: 7, company_id: 'co-2' }] }
    if (c.target === 'companies') return { data: [{ id: 'co-1', name: 'Lahore Beverages' }, { id: 'co-2', name: 'Margalla Foods' }] }
    return { data: [] }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const onOpenChange = () => {}
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BurstSheet open onOpenChange={onOpenChange} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return db
}

afterEach(() => installFakeDb(() => ({})).uninstall())

const saves = (db: ReturnType<typeof installFakeDb>) => db.calls.filter(c => c.target === 'expenses' && c.verb === 'upsert')

describe('burst entry sheet (M11)', () => {
  it('shows the defaults: most used category, today, paid via from the category, with no tags or key legends (R2-12)', async () => {
    setup()
    const amount = await screen.findByRole('textbox', { name: 'Amount, row 1' })
    const category = screen.getByRole('combobox', { name: 'Category, row 1' })
    expect(category).toHaveValue('Office supplies & snacks')
    expect(category).toHaveClass('border-dashed') // filled in for you: the dashed edge, no words
    expect(screen.getByText('today')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Paid via, row 1' })).toHaveValue('cash')
    for (const gone of ['most used', 'from category', 'adds a row', /saves all/, /Filled in for you/, 'You typed this', /Keyboard only/]) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument()
    }
    // Ctrl Enter is still said inside the Save button
    expect(screen.getByRole('button', { name: /^Save/ })).toHaveTextContent('Ctrl')
    await waitFor(() => expect(amount).toHaveFocus())
  })

  it('five small spends: five amounts, four Enters and one Ctrl+Enter save one bulk insert with client ids', async () => {
    const user = userEvent.setup()
    const db = setup()
    const first = await screen.findByRole('textbox', { name: 'Amount, row 1' })
    await waitFor(() => expect(first).toHaveFocus())
    await user.keyboard('450{Enter}600{Enter}3500{Enter}850{Enter}1200')
    expect(screen.getAllByRole('textbox', { name: /^Amount, row/ })).toHaveLength(5)
    // the category carried down every row, shown by the dashed edge
    for (const n of [2, 3, 4, 5]) expect(screen.getByRole('combobox', { name: `Category, row ${n}` })).toHaveClass('border-dashed')
    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => expect(saves(db)).toHaveLength(1))
    const rows = opArgs(saves(db)[0], 'upsert')?.[0] as { id: string; amount_pkr: number; paid_via: string }[]
    expect(rows.map(r => r.amount_pkr)).toEqual([450, 600, 3500, 850, 1200])
    expect(new Set(rows.map(r => r.id)).size).toBe(5)
    expect(rows.every(r => r.paid_via === 'cash')).toBe(true)
    expect(opArgs(saves(db)[0], 'upsert')?.[1]).toMatchObject({ onConflict: 'id', ignoreDuplicates: true })
  })

  it('a double Ctrl+Enter sends one request', async () => {
    const user = userEvent.setup()
    const db = setup(() => new Promise(r => setTimeout(() => r({}), 150)))
    const first = await screen.findByRole('textbox', { name: 'Amount, row 1' })
    await waitFor(() => expect(first).toHaveFocus())
    await user.keyboard('450{Control>}{Enter}{Enter}{/Control}')
    await waitFor(() => expect(saves(db)).toHaveLength(1))
    await new Promise(r => setTimeout(r, 30))
    expect(saves(db)).toHaveLength(1)
  })

  it('type-ahead: two letters and Tab accept the category and set paid via from it', async () => {
    const user = userEvent.setup()
    setup()
    const amount = await screen.findByRole('textbox', { name: 'Amount, row 1' })
    await waitFor(() => expect(amount).toHaveFocus())
    await user.keyboard('3500{Tab}')
    expect(screen.getByRole('combobox', { name: 'Category, row 1' })).toHaveFocus()
    await user.keyboard('sa')
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    await user.keyboard('{Tab}')
    expect(screen.getByRole('combobox', { name: 'Category, row 1' })).toHaveValue('Salaries')
    expect(screen.getByRole('combobox', { name: 'Paid via, row 1' })).toHaveValue('bank')
  })

  describe('the saved values are the ones on screen, however fast the keys come', () => {
    type Row = { amount_pkr: number; paid_on: string; category_id: string; description: string | null }
    const savedRows = (db: ReturnType<typeof installFakeDb>) => opArgs(saves(db)[0], 'upsert')?.[0] as Row[]

    it('a date typed and Ctrl+Enter pressed with the cursor still in the date cell saves the typed date', async () => {
      const user = userEvent.setup()
      const db = setup()
      const first = await screen.findByRole('textbox', { name: 'Amount, row 1' })
      await waitFor(() => expect(first).toHaveFocus())
      await user.keyboard('500{Tab}{Tab}05/09/2024{Control>}{Enter}{/Control}')
      await waitFor(() => expect(saves(db)).toHaveLength(1))
      expect(savedRows(db)[0]).toMatchObject({ amount_pkr: 500, paid_on: '2024-09-05' })
    })

    it('a date typed, Tab and Ctrl+Enter with no tick between them (the blur read has not run) saves the typed date', async () => {
      const user = userEvent.setup()
      const db = setup()
      const first = await screen.findByRole('textbox', { name: 'Amount, row 1' })
      await waitFor(() => expect(first).toHaveFocus())
      await user.keyboard('500{Tab}{Tab}05/09/2024')
      const date = screen.getByRole('textbox', { name: 'Date, row 1' })
      // the blur schedules the read for the next tick; the keys arrive before it
      fireEvent.blur(date)
      fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true })
      await waitFor(() => expect(saves(db)).toHaveLength(1))
      expect(savedRows(db)[0]).toMatchObject({ amount_pkr: 500, paid_on: '2024-09-05' })
    })

    it('text that is not a date is not saved as today: the row waits for a date', async () => {
      const user = userEvent.setup()
      const db = setup()
      const first = await screen.findByRole('textbox', { name: 'Amount, row 1' })
      await waitFor(() => expect(first).toHaveFocus())
      await user.keyboard('500{Tab}{Tab}garbage{Control>}{Enter}{/Control}')
      await new Promise(r => setTimeout(r, 50))
      expect(saves(db)).toHaveLength(0)
    })

    it('a category typed and Ctrl+Enter pressed with the list still open saves the highlighted category', async () => {
      const user = userEvent.setup()
      const db = setup()
      const first = await screen.findByRole('textbox', { name: 'Amount, row 1' })
      await waitFor(() => expect(first).toHaveFocus())
      await user.keyboard('500{Tab}sa{Control>}{Enter}{/Control}')
      await waitFor(() => expect(saves(db)).toHaveLength(1))
      expect(savedRows(db)[0]).toMatchObject({ amount_pkr: 500, category_id: 'c-sal' })
    })

    it('clicking Save with a category half-typed accepts the highlighted match, as Tab does', async () => {
      const user = userEvent.setup()
      const db = setup()
      const first = await screen.findByRole('textbox', { name: 'Amount, row 1' })
      await waitFor(() => expect(first).toHaveFocus())
      await user.keyboard('500{Tab}sa')
      expect(screen.getByText('1 of 3')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /^Save/ }))
      await waitFor(() => expect(saves(db)).toHaveLength(1))
      expect(savedRows(db)[0]).toMatchObject({ amount_pkr: 500, category_id: 'c-sal' })
    })

    it('clicking Save with category text that matches nothing saves nothing and says so on the row', async () => {
      const user = userEvent.setup()
      const db = setup()
      const first = await screen.findByRole('textbox', { name: 'Amount, row 1' })
      await waitFor(() => expect(first).toHaveFocus())
      await user.keyboard('500{Tab}zzz')
      await user.click(screen.getByRole('button', { name: /^Save/ }))
      await new Promise(r => setTimeout(r, 50))
      expect(saves(db)).toHaveLength(0)
      expect(screen.getByText(/No category matches "zzz"/)).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Category, row 1' })).toHaveValue('zzz') // still on screen, not thrown away
    })

    it('an amount and a note typed on the last keystroke before Ctrl+Enter are saved', async () => {
      const user = userEvent.setup()
      const db = setup()
      const first = await screen.findByRole('textbox', { name: 'Amount, row 1' })
      await waitFor(() => expect(first).toHaveFocus())
      await user.keyboard('1234{Tab}{Tab}{Tab}{Tab}tea{Control>}{Enter}{/Control}')
      await waitFor(() => expect(saves(db)).toHaveLength(1))
      expect(savedRows(db)[0]).toMatchObject({ amount_pkr: 1234, description: 'tea' })
    })
  })

  it('a closed month shows its sentence on the offending row; every row keeps what it holds and nothing is lost', async () => {
    const user = userEvent.setup()
    const db = setup(() => ({ error: { code: 'P0001', message: 'September 2026 is closed. An admin can reopen it.' } }))
    const first = await screen.findByRole('textbox', { name: 'Amount, row 1' })
    await waitFor(() => expect(first).toHaveFocus())
    await user.keyboard('450{Enter}100000{Tab}{Tab}30 sep{Tab}')
    await user.keyboard('{Control>}{Enter}{/Control}')
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('September 2026 is closed. An admin can reopen it.')).toBeInTheDocument()
    expect(alert).toHaveTextContent('Nothing was saved')
    expect(screen.getByRole('textbox', { name: 'Amount, row 1' })).toHaveValue('450')
    expect(screen.getByRole('textbox', { name: 'Amount, row 2' })).toHaveValue('100,000')
    expect(screen.getByText('1 row needs a change')).toBeInTheDocument()
    expect(saves(db)).toHaveLength(1)
  })

  describe('the optional Order tag (audit X1)', () => {
    type Row = { amount_pkr: number; order_id?: string }
    const savedRows = (db: ReturnType<typeof installFakeDb>) => opArgs(saves(db)[0], 'upsert')?.[0] as Row[]

    it('is skippable: Tab passes over it empty and the expense saves untagged', async () => {
      const user = userEvent.setup()
      const db = setup()
      const first = await screen.findByRole('textbox', { name: 'Amount, row 1' })
      await waitFor(() => expect(first).toHaveFocus())
      // amount, category, date, paid via, note, order, then the photo button
      await user.keyboard('500{Tab}{Tab}{Tab}{Tab}{Tab}')
      expect(screen.getByRole('combobox', { name: 'Order, row 1' })).toHaveFocus()
      await user.keyboard('{Tab}')
      expect(screen.getByRole('button', { name: 'Add receipt photo, row 1' })).toHaveFocus()
      await user.keyboard('{Control>}{Enter}{/Control}')
      await waitFor(() => expect(saves(db)).toHaveLength(1))
      expect('order_id' in savedRows(db)[0]).toBe(false)
    })

    it('type-ahead on the order number: Tab accepts the first match and the expense is saved with that order', async () => {
      const user = userEvent.setup()
      const db = setup()
      const first = await screen.findByRole('textbox', { name: 'Amount, row 1' })
      await waitFor(() => expect(first).toHaveFocus())
      await user.keyboard('2500{Tab}{Tab}{Tab}{Tab}{Tab}42')
      expect(await screen.findByRole('option', { name: /ORD-0042/ })).toBeInTheDocument()
      await user.keyboard('{Tab}')
      expect(screen.getByRole('combobox', { name: 'Order, row 1' })).toHaveValue('ORD-0042')
      expect(screen.getByRole('button', { name: 'Add receipt photo, row 1' })).toHaveFocus()
      await user.keyboard('{Control>}{Enter}{/Control}')
      await waitFor(() => expect(saves(db)).toHaveLength(1))
      expect(savedRows(db)[0]).toMatchObject({ amount_pkr: 2500, order_id: 'o-42' })
    })

    it('an order that matches nothing is not dropped quietly: nothing is saved until it is fixed or cleared', async () => {
      const user = userEvent.setup()
      const db = setup()
      const first = await screen.findByRole('textbox', { name: 'Amount, row 1' })
      await waitFor(() => expect(first).toHaveFocus())
      await user.keyboard('500{Tab}{Tab}{Tab}{Tab}{Tab}9999{Tab}{Control>}{Enter}{/Control}')
      expect(await screen.findByText(/No order matches "9999"/)).toBeInTheDocument()
      expect(saves(db)).toHaveLength(0)
      const box = screen.getByRole('combobox', { name: 'Order, row 1' })
      await user.clear(box)
      await user.keyboard('{Tab}{Control>}{Enter}{/Control}')
      await waitFor(() => expect(saves(db)).toHaveLength(1))
      expect('order_id' in savedRows(db)[0]).toBe(false)
    })
  })

  describe('a new category from the category box (owner request 2026-10-20)', () => {
    function setupCreate() {
      const cats = [...CATEGORIES]
      const db = installFakeDb((c: FakeCall) => {
        if (c.target === 'expense_categories' && c.verb === 'insert') {
          const row = opArgs(c, 'insert')?.[0] as Record<string, unknown>
          cats.push({ id: 'c-water', name: String(row.name), grp: String(row.grp), default_paid_via: String(row.default_paid_via), sort: Number(row.sort), active: true })
          return { data: [{ id: 'c-water' }] }
        }
        if (c.target === 'expense_categories') return { data: [...cats] }
        if (c.target === 'expenses' && c.verb === 'select') return { data: [{ category_id: 'c-snacks', paid_on: '2026-11-01' }] }
        if (c.target === 'v_month_cash_out_detail') return { data: [{ category_id: 'c-fuel', detail: 'LEA-1234', expense_count: 3, last_paid_on: '2026-11-02' }] }
        return { data: [] }
      })
      const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
      render(
        <QueryClientProvider client={client}>
          <ToastProvider>
            <BurstSheet open onOpenChange={() => {}} />
          </ToastProvider>
        </QueryClientProvider>,
      )
      return db
    }

    it('typing a name that is no category offers Create, paid in cash first; Enter creates it under Overheads and selects it', async () => {
      const user = userEvent.setup()
      const db = setupCreate()
      const amount = await screen.findByRole('textbox', { name: 'Amount, row 1' })
      await waitFor(() => expect(amount).toHaveFocus())
      await user.keyboard('500{Tab}Office water')
      const list = await screen.findByRole('listbox', { name: 'Categories' })
      const options = within(list).getAllByRole('option')
      expect(options.map(o => o.textContent)).toEqual(['Create “Office water”Overhead · paid in cash', 'Create “Office water”Overhead · paid by bank'])
      await user.keyboard('{Enter}')
      await waitFor(() => expect(screen.getByRole('combobox', { name: 'Category, row 1' })).toHaveValue('Office water'))
      const insert = db.calls.find(c => c.target === 'expense_categories' && c.verb === 'insert')!
      expect(opArgs(insert, 'insert')?.[0]).toEqual({ name: 'Office water', grp: 'overhead', default_paid_via: 'cash', sort: 60 })
      // the row follows the new category's paid via
      expect(screen.getByRole('combobox', { name: 'Paid via, row 1' })).toHaveValue('cash')
      await user.keyboard('{Control>}{Enter}{/Control}')
      await waitFor(() => expect(saves(db)).toHaveLength(1))
      expect((opArgs(saves(db)[0], 'upsert')?.[0] as Record<string, unknown>[])[0]).toMatchObject({ amount_pkr: 500, category_id: 'c-water', paid_via: 'cash' })
    })

    it('a name that only differs in case is the existing category, not a new one', async () => {
      const user = userEvent.setup()
      setupCreate()
      const amount = await screen.findByRole('textbox', { name: 'Amount, row 1' })
      await waitFor(() => expect(amount).toHaveFocus())
      await user.keyboard('{Tab}fuel & TRAVEL')
      const list = await screen.findByRole('listbox', { name: 'Categories' })
      expect(within(list).queryByText(/Create/)).toBeNull()
    })

    it('the Detail cell suggests what was typed before', async () => {
      setupCreate()
      const detail = await screen.findByRole('combobox', { name: 'Detail, row 1' })
      const list = document.getElementById(detail.getAttribute('list') ?? '')
      await waitFor(() => expect(list?.querySelectorAll('option')).toHaveLength(1))
      expect(list?.querySelector('option')?.getAttribute('value')).toBe('LEA-1234')
    })
  })
})
