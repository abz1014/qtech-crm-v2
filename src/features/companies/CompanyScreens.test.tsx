import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { CompaniesPage } from '@/features/companies/CompaniesPage'
import { CompanyPage } from '@/features/companies/CompanyPage'
import { businessToday } from '@/lib/dates'
import { axeViolations } from '@/test/axe'
import { installFakeDb, opArgs, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/*
 * The Companies screens after the UX audit of 2026-10-19 (9a, 9b): a supplier's useful history first (Recent quotes,
 * Deliveries, then a compact "What we know"), the rules behind the numbers in (i) tips, Roles and Brands folded into one
 * Details panel, no locked compact tables, and a list search that finds a company by a contact's name or phone.
 */
const TODAY = businessToday()
const day = (n: number) => {
  const d = new Date(`${TODAY}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function mount(path: string, ui: ReactNode, role: 'admin' | 'sales' | 'engineer' = 'sales') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Someone', role } }}>
        <MemoryRouter initialEntries={[path]}>
          <ToastProvider>
            <Routes>
              <Route path="/companies" element={ui} />
              <Route path="/companies/:id" element={ui} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => installFakeDb(() => ({})).uninstall())

const sel = (c: FakeCall) => String(opArgs(c, 'select')?.[0] ?? '')

/** A supplier with six enquiries, one quote ordered here, one late delivery and two brands (Belimo quoted 3 times). */
function supplierDb(c: FakeCall): FakeResult {
  switch (c.target) {
    case 'companies':
      return { data: { id: 's1', name: 'Alpenmark Controls', country: 'Austria', city: 'Linz', notes: null, created_at: '2024-02-01T00:00:00Z', legacy_flags: [], imported: null } }
    case 'v_company_roles':
      return { data: { role: 'supplier', is_customer: false, is_supplier: true } }
    case 'v_supplier_stats':
      return {
        data: {
          supplier_id: 's1', asked: 6, replied: 5, quoted: 4, no_offer: 1, legacy_asked: 0, orders_count: 2, reply_days_n: 5, median_reply_days: 3,
          chosen_of: 4, chosen: 2, deliveries: 4, late: 1, median_days_late: 6, last_contact: day(-3), brand_ids: [], brand_names: [], prices_hidden: 0,
        },
      }
    case 'company_brands':
      return { data: [{ brand_id: 'b1', brands: { name: 'Belimo', kind: 'brand' } }, { brand_id: 'b2', brands: { name: 'Siemens', kind: 'brand' } }] }
    case 'supplier_quote_lines':
      return sel(c).includes('rfq_items!inner')
        ? { data: [1, 2, 3].map(() => ({ legacy_flags: [], rfq_items: { brand_id: 'b1', family_id: null } })) }
        : {
            data: [
              { id: 'x1', inquiry_id: 'q1', rfq_item_id: 't1', unit_price: 214, currency: 'EUR', lead_time: '2 to 3 weeks ex stock', fx_rate_pkr: 326.8, fx_rate_on: day(-29), created_at: `${day(-29)}T10:00:00Z`, legacy_flags: [], imported: null },
            ],
          }
    case 'supplier_inquiries':
      return { data: [{ id: 'q1', rfq_id: 'r1', sent_on: day(-30), last_chased_on: null, chase_count: 0, no_offer_on: null, no_offer_reason: null, imported: null }] }
    case 'supplier_orders':
      return { data: [{ id: 'l1', placed_on: day(-25), expected_on: day(-15), received_on: day(-9), currency: 'EUR', imported: null, orders: { number: 38, cancelled_on: null } }] }
    case 'rfq_items':
      return { data: [{ id: 't1', rfq_id: 'r1', position: 1, description: 'Belimo NM24A-SR damper actuator', qty: 2, unit: 'pcs', brand_id: 'b1' }] }
    case 'rfqs':
      // The supplier's enquiries name RFQ-0171; it has no RFQs of its own as a customer.
      return sel(c).includes('received_on') ? { data: [] } : { data: [{ id: 'r1', number: 171, closed_on: null }] }
    case 'brands':
      return { data: [{ id: 'b1', name: 'Belimo' }] }
    case 'purchase_orders':
      return { data: [{ supplier_order_id: 'l1', number: 17, revision: 0, issued_on: day(-25) }] }
    case 'order_items':
      return { data: [{ rfq_item_id: 't1', orders: { number: 38, cancelled_on: null }, supplier_orders: { supplier_id: 's1' } }] }
    case 'v_supplier_activity':
      return { data: [{ inquiry_id: 'q1', rfq_id: 'r1', sent_on: day(-30), replied: true, quoted: true, no_offer: false, reply_days: 1, is_legacy: false }] }
    default:
      return { data: [] }
  }
}

/** A customer in Karachi with one site and an open RFQ whose quotation is due in 9 days. */
function customerDb(c: FakeCall): FakeResult {
  switch (c.target) {
    case 'companies':
      return { data: { id: 'c1', name: 'Karachi Glassworks', country: 'Pakistan', city: 'Karachi', notes: null, created_at: '2023-05-01T00:00:00Z', legacy_flags: [], imported: null } }
    case 'v_company_roles':
      return { data: { role: 'prospect', is_customer: true, is_supplier: false } }
    case 'company_sites':
      return { data: [{ id: 'site1', name: 'Main plant', address: 'Plot 14, Landhi' }] }
    case 'contacts':
      return { data: [{ id: 'p1', name: 'Naveed Akhtar', phone: '0301 5550142', email: null, job_title: 'Finance', notes: null, site_id: 'site1' }] }
    case 'rfqs':
      return { data: [{ id: 'r9', number: 177, site_id: 'site1', received_on: '2024-03-04', due_on: day(9), customer_ref: null, close_reason: null }] }
    case 'v_rfq_state':
      return { data: [{ rfq_id: 'r9', outcome: 'open' }] }
    case 'rfq_items':
      return { data: [{ rfq_id: 'r9', description: 'Furnace thermocouples', position: 1 }] }
    default:
      return { data: [] }
  }
}

const h2s = (root: HTMLElement) => within(root).getAllByRole('heading', { level: 2 }).map(h => h.textContent)

describe('supplier page', () => {
  it('shows the useful history first: Recent quotes, Deliveries, What we know, Recent enquiries', async () => {
    installFakeDb(supplierDb)
    mount('/companies/s1', <CompanyPage />)
    await screen.findByRole('heading', { level: 1, name: /Alpenmark Controls/ })
    await screen.findByText('Belimo NM24A-SR damper actuator')
    const main = screen.getByRole('heading', { name: 'Recent quotes' }).closest('div.grid') as HTMLElement
    expect(h2s(main)).toEqual(['Recent quotes', 'Deliveries', 'What we know', 'Recent enquiries'])
    const side = screen.getByRole('complementary', { name: 'Company details' })
    expect(h2s(side)).toEqual(['Contacts', 'Open with them', 'Details'])
    expect(screen.queryByRole('heading', { name: 'Roles' })).not.toBeInTheDocument()
    expect(await axeViolations(document.body)).toEqual([])
  })

  it('says the record once in the header, in counts; New RFQ is not the main action on a supplier-only page', async () => {
    installFakeDb(supplierDb)
    mount('/companies/s1', <CompanyPage />)
    await waitFor(() => expect(screen.getByTestId('supplier-record-line')).toHaveTextContent('Replied 5 of 6 · quoted 4 · late 1 of 4'))
    // intake cannot start from a supplier, so New RFQ here is a plain, secondary button (the supplier's history is the page's point)
    expect(screen.getByRole('button', { name: 'New RFQ' })).not.toHaveClass('bg-primary')
    expect(screen.queryByText(/Float/)).not.toBeInTheDocument()
  })

  it('"What we know" is plain counts with no squares and no rule prose; the rules are behind the (i)', async () => {
    installFakeDb(supplierDb)
    const user = userEvent.setup()
    mount('/companies/s1', <CompanyPage />)
    await screen.findByRole('button', { name: 'About these numbers' })
    const what = screen.getByRole('region', { name: 'What we know' })
    expect(what).toHaveTextContent("Replied 5 of 6 · quoted 4 · couldn't offer 1")
    expect(what).toHaveTextContent('Late 1 of 4 · about 6 days over')
    expect(what).toHaveTextContent('About 3 days')
    expect(what).toHaveTextContent('2 of 4 times')
    expect(what.querySelector('[role="img"]')).toBeNull()
    expect(what.textContent).not.toMatch(/score|rating|rank|%/i)
    expect(document.body.textContent).not.toMatch(/Where this comes from|Middle value of|Original currency first/)

    await user.click(within(what).getByRole('button', { name: 'About these numbers' }))
    const tip = await screen.findByRole('dialog', { name: 'About these numbers' })
    expect(tip).toHaveTextContent('Counted from enquiries, quotes, POs and delivery dates. Nothing is typed in.')
    expect(tip).toHaveTextContent('Reply time is the middle of the 5 replies logged here.')
    expect(tip).toHaveTextContent('Chosen: quoted items later ordered from them.')
    expect(await axeViolations(tip)).toEqual([])
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'About these numbers' })).toBeNull())
  })

  it('the quotes read item, price (with PKR at the time) and outcome; deliveries keep their PO and result', async () => {
    installFakeDb(supplierDb)
    mount('/companies/s1', <CompanyPage />)
    const quotes = await screen.findByRole('region', { name: 'Recent quotes' })
    const row = await within(quotes).findByText('Belimo NM24A-SR damper actuator')
    const li = row.closest('li') as HTMLElement
    expect(li).toHaveTextContent(/EUR\s*214\.00/)
    expect(li).toHaveTextContent(/≈ PKR\s*69,935/)
    expect(li).toHaveTextContent('Lead time: 2 to 3 weeks ex stock')
    expect(li).toHaveTextContent('Ordered here')
    expect(within(quotes).getByRole('link', { name: 'All enquiries' })).toBeInTheDocument()
    const deliveries = screen.getByRole('region', { name: 'Deliveries' })
    expect(deliveries).toHaveTextContent('Late 6 days')
    expect(deliveries).toHaveTextContent(/PO-\d\d-\d{4}/)
    expect(screen.getByRole('region', { name: 'Open with them' })).toHaveTextContent('Supplier orders')
  })

  it('Details holds the brands carried as tags, with how often each was quoted, and Add and remove', async () => {
    installFakeDb(supplierDb)
    const user = userEvent.setup()
    mount('/companies/s1', <CompanyPage />)
    const details = await screen.findByRole('region', { name: 'Details' })
    const brands = within(details).getByRole('region', { name: 'Brands carried' })
    await waitFor(() => expect(within(brands).getByText('Belimo').closest('li')).toHaveTextContent('quoted 3×'))
    expect(within(brands).getByText('Siemens').closest('li')).not.toHaveTextContent('quoted')
    expect(within(details).queryByText('Customer since')).not.toBeInTheDocument()
    await user.click(within(brands).getByRole('button', { name: 'Remove Siemens' }))
    expect(within(brands).getByRole('group', { name: 'Remove Siemens?' })).toBeInTheDocument()
    await user.click(within(brands).getByRole('button', { name: 'Add' }))
    expect(within(brands).getByRole('combobox', { name: 'Brand or product family' })).toBeInTheDocument()
  })

  it('no table is locked to the compact density', async () => {
    installFakeDb(supplierDb)
    mount('/companies/s1', <CompanyPage />)
    await screen.findByRole('table', { name: 'Recent enquiries' })
    expect(document.querySelector('[data-density="compact"]')).toBeNull()
  })
})

describe('customer page', () => {
  it('keeps its sites as the main column; Details says since when and whether they also supply us, once', async () => {
    installFakeDb(customerDb)
    mount('/companies/c1', <CompanyPage />)
    const site = await screen.findByRole('region', { name: 'Main plant' })
    await within(site).findByText('Furnace thermocouples')
    expect(within(site).getByText(/^quotation due \w{3} \d/)).toBeInTheDocument()
    expect(document.querySelector('[data-density="compact"]')).toBeNull()
    const details = screen.getByRole('region', { name: 'Details' })
    await waitFor(() => expect(details).toHaveTextContent('Customer since2024'))
    expect(details).toHaveTextContent('Also a supplierNo')
    expect(within(details).queryByRole('region', { name: 'Brands carried' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New RFQ' })).toBeInTheDocument()
    expect(screen.queryByTestId('supplier-record-line')).not.toBeInTheDocument()
    expect(await axeViolations(document.body)).toEqual([])
  })
})

const listDb = (c: FakeCall): FakeResult => {
  switch (c.target) {
    case 'companies':
      return {
        data: [
          { id: 'a', name: 'Alpenmark Controls', country: 'Austria', city: 'Linz', updated_at: 't' },
          { id: 'b', name: 'Karachi Glassworks', country: 'Pakistan', city: 'Karachi', updated_at: 't' },
          { id: 'c', name: 'Lahore Mills', country: 'Pakistan', city: null, updated_at: 't' },
          { id: 'd', name: 'Indus Textile', country: 'Pakistan', city: 'Faisalabad', updated_at: 't' },
          { id: 'e', name: 'Punjab Cement', country: 'Pakistan', city: 'Lahore', updated_at: 't' },
        ],
      }
    case 'v_company_roles':
      return { data: [{ company_id: 'a', role: 'supplier' }, { company_id: 'b', role: 'both' }] }
    case 'contacts':
      return { data: [{ company_id: 'b', name: 'Naveed Akhtar', phone: '+92 301 555 0142' }] }
    default:
      return { data: [] }
  }
}

describe('companies list', () => {
  it('shows the city, not the home country on every row, and "Both" as a light, plain chip', async () => {
    installFakeDb(listDb)
    mount('/companies', <CompaniesPage />)
    const glass = (await screen.findByRole('link', { name: 'Karachi Glassworks' })).closest('tr') as HTMLElement
    expect(glass).toHaveTextContent('Karachi')
    expect(glass).not.toHaveTextContent('Pakistan')
    expect(within(glass).getByText('Customer & supplier').closest('[data-status]')).toHaveAttribute('data-status', 'company-role:customer')
    expect((screen.getByRole('link', { name: 'Alpenmark Controls' }).closest('tr') as HTMLElement)).toHaveTextContent('Linz, Austria')
    expect((screen.getByRole('link', { name: 'Lahore Mills' }).closest('tr') as HTMLElement)).toHaveTextContent('Pakistan')
    expect(await axeViolations(document.body)).toEqual([])
  })

  it('finds a company by a contact name or a phone number written either way, and says which contact', async () => {
    installFakeDb(listDb)
    const user = userEvent.setup()
    mount('/companies', <CompaniesPage />)
    await screen.findByRole('link', { name: 'Karachi Glassworks' })
    const search = screen.getByRole('textbox', { name: 'Search companies' })
    expect(search).toHaveAttribute('placeholder', 'Name, contact, phone or city')

    await user.type(search, 'naveed')
    expect(screen.getByRole('link', { name: 'Karachi Glassworks' }).closest('tr')).toHaveTextContent('Contact: Naveed Akhtar')
    expect(screen.queryByRole('link', { name: 'Alpenmark Controls' })).not.toBeInTheDocument()

    await user.clear(search)
    await user.type(search, '0301 5550142')
    expect(screen.getByRole('link', { name: 'Karachi Glassworks' })).toBeInTheDocument()
    expect(screen.getAllByRole('link').filter(a => a.getAttribute('href')?.startsWith('/companies/'))).toHaveLength(1)

    await user.clear(search)
    await user.type(search, '0399 1234567')
    expect(await screen.findByText('No company matches')).toBeInTheDocument()
    // A number is not offered as a new company's name.
    expect(screen.queryByRole('button', { name: /Add “0399/ })).not.toBeInTheDocument()
  })

  it('an Urdu-script name that matches nothing is offered as a new company (review 2026-10-20)', async () => {
    installFakeDb(listDb)
    const user = userEvent.setup()
    mount('/companies', <CompaniesPage />)
    await screen.findByRole('link', { name: 'Karachi Glassworks' })
    await user.type(screen.getByRole('textbox', { name: 'Search companies' }), 'کراچی سیمنٹ')
    expect(await screen.findByText('No company matches')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add “کراچی سیمنٹ”' })).toBeInTheDocument()
  })
})
