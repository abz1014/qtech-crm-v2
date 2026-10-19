import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import { CompanyProfilePage } from '@/features/settings/CompanyProfilePage'
import { effectiveTerms, missingForPdf, profileSchema, termsLabel, toFormValues, toRow, type CompanyProfile } from '@/features/settings/companyProfile'
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
} as unknown as Db


const EMPTY: CompanyProfile = {
  legal_name: null,
  address: null,
  phone: null,
  email: null,
  website: null,
  ntn: null,
  strn: null,
  bank_name: null,
  bank_account_title: null,
  bank_iban: null,
  quotation_validity_days: 30,
  default_payment_terms_days: 30,
  quotation_terms: null,
  po_terms: null,
  updated_at: '2026-01-01T00:00:00Z',
}
const FULL: CompanyProfile = {
  ...EMPTY,
  legal_name: 'Q-Tech Solutions (Private) Limited',
  address: 'Plot 14, Karachi',
  ntn: '3827149-5',
  bank_iban: 'PK36 INDC 0000 0012 3456 7891',
  quotation_terms: '1. Prices are in PKR.',
}

const as = (role: string): SessionState => ({ status: 'signed-in', user: { id: 'u', name: 'Someone', role } })

function mount(role: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SessionProvider value={as(role)}>
        <MemoryRouter>
          <ToastProvider>
            <div data-testid="page">
              <CompanyProfilePage />
            </div>
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  setSupabaseForTests(fakeDb)
  h.row = FULL
  h.update.mockReset()
  h.updated = []
})

afterEach(() => setSupabaseForTests(null))

describe('company profile rules', () => {
  it('blank text is stored as null and values are trimmed', () => {
    const row = toRow({ ...toFormValues(EMPTY), legal_name: '  Q-Tech ', phone: '   ', quotation_validity_days: 45 })
    expect(row.legal_name).toBe('Q-Tech')
    expect(row.phone).toBeNull()
    expect(row.bank_iban).toBeNull()
    expect(row.quotation_validity_days).toBe(45)
  })

  it('the default payment terms (audit Y1) are saved, whole days from 0 to a year', () => {
    expect(toRow({ ...toFormValues(EMPTY), default_payment_terms_days: 45 }).default_payment_terms_days).toBe(45)
    expect(profileSchema.safeParse({ ...toFormValues(EMPTY), default_payment_terms_days: 0 }).success).toBe(true)
    expect(profileSchema.safeParse({ ...toFormValues(EMPTY), default_payment_terms_days: -1 }).success).toBe(false)
    expect(profileSchema.safeParse({ ...toFormValues(EMPTY), default_payment_terms_days: 366 }).success).toBe(false)
    expect(profileSchema.safeParse({ ...toFormValues(EMPTY), default_payment_terms_days: 2.5 }).success).toBe(false)
  })

  it('own terms on an order win (including 0); with none the company default applies and is labelled', () => {
    expect(effectiveTerms(10, 30)).toEqual({ days: 10, isDefault: false })
    expect(effectiveTerms(0, 30)).toEqual({ days: 0, isDefault: false })
    expect(effectiveTerms(null, 45)).toEqual({ days: 45, isDefault: true })
    expect(effectiveTerms(null, undefined)).toEqual({ days: 30, isDefault: true })
    expect(termsLabel(null, 30)).toBe('Terms 30 days from invoice (default terms)')
    expect(termsLabel(14, 30)).toBe('Terms 14 days from invoice')
  })

  it('every text field is optional; only the validity days has a rule', () => {
    expect(profileSchema.safeParse(toFormValues(EMPTY)).success).toBe(true)
    expect(profileSchema.safeParse({ ...toFormValues(EMPTY), quotation_validity_days: 0 }).success).toBe(false)
    expect(profileSchema.safeParse({ ...toFormValues(EMPTY), email: 'not-an-email' }).success).toBe(false)
    expect(profileSchema.safeParse({ ...toFormValues(EMPTY), email: '' }).success).toBe(true)
  })

  it('PDFs need only legal name and address', () => {
    expect(missingForPdf(EMPTY)).toEqual(['legal_name', 'address'])
    expect(missingForPdf({ legal_name: ' ', address: 'x' })).toEqual(['legal_name'])
    expect(missingForPdf(FULL)).toEqual([])
  })
})

describe('Company profile screen', () => {
  it('an admin gets the form with defaults, and Save is off until something changes', async () => {
    mount('admin')
    expect(await screen.findByLabelText(/Legal name/)).toHaveValue('Q-Tech Solutions (Private) Limited')
    expect(screen.getByLabelText('Quotation validity')).toHaveValue('30')
    expect(screen.getByText('Nothing to save yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    expect(screen.queryByText("PDFs can't be issued until legal name and address are set")).toBeNull()
  })

  it('saves only what is filled, blank fields as null, and names the unsaved change first', async () => {
    h.row = { ...EMPTY }
    h.updated = [{ ...EMPTY, legal_name: 'Q-Tech Solutions', address: 'Karachi' }]
    const user = userEvent.setup()
    mount('admin')
    expect(await screen.findByText("PDFs can't be issued until legal name and address are set")).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Legal name/), 'Q-Tech Solutions')
    await user.type(screen.getByLabelText(/Address/), 'Karachi')
    expect(screen.getByText('2 unsaved changes: Legal name, Address')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1))
    expect(h.update.mock.calls[0][0]).toMatchObject({ legal_name: 'Q-Tech Solutions', address: 'Karachi', phone: null, bank_iban: null, quotation_validity_days: 30 })
    expect(await screen.findByText('Company profile saved')).toBeInTheDocument()
    expect(screen.getByText('PDFs can be issued now.')).toBeInTheDocument()
    expect(screen.getByText('Nothing to save yet')).toBeInTheDocument()
  })

  it('shows the default payment terms (30 days) and saves a new value (audit Y1)', async () => {
    h.row = { ...EMPTY }
    h.updated = [{ ...EMPTY, default_payment_terms_days: 45 }]
    const user = userEvent.setup()
    mount('admin')
    const field = await screen.findByLabelText('Default payment terms')
    expect(field).toHaveValue('30')
    await user.clear(field)
    await user.type(field, '45')
    expect(screen.getByText('1 unsaved change: Default payment terms')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1))
    expect(h.update.mock.calls[0][0]).toMatchObject({ default_payment_terms_days: 45 })
  })

  it('draws an empty legal name and address invalid with their own sentences, before any save', async () => {
    h.row = { ...EMPTY }
    const user = userEvent.setup()
    mount('admin')
    const name = await screen.findByLabelText(/Legal name/)
    expect(name).toBeInvalid()
    expect(screen.getByText('Add the legal name before issuing a PDF.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Address/)).toBeInvalid()
    expect(screen.getByText('Add the address before issuing a PDF.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Address/)).toHaveAttribute('rows', '2')
    await user.type(name, 'Q-Tech')
    expect(screen.queryByText('Add the legal name before issuing a PDF.')).toBeNull()
  })

  it('keeps the save bar a static card (not sticky) and sets the purchase order terms to 4 rows', async () => {
    mount('admin')
    const bar = (await screen.findByText('Nothing to save yet')).parentElement as HTMLElement
    expect(bar.className).not.toContain('sticky')
    expect(screen.getByLabelText('Purchase order terms')).toHaveAttribute('rows', '4')
    expect(screen.getByLabelText('Quotation terms')).toHaveAttribute('rows', '5')
  })

  it('says so when the database refuses the change (not an admin) instead of showing success', async () => {
    h.updated = [] // RLS: an update that matches no allowed row returns no rows, and no error
    const user = userEvent.setup()
    mount('admin')
    await user.type(await screen.findByLabelText(/Phone/), '021')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Only an admin can change the company profile.')).toBeInTheDocument()
    expect(screen.queryByText('Company profile saved')).toBeNull()
  })

  it('shows a validation message in place and does not save', async () => {
    const user = userEvent.setup()
    mount('admin')
    const email = await screen.findByLabelText(/Email/)
    await user.type(email, 'nope')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Enter a valid email address, or leave it empty.')).toBeInTheDocument()
    expect(h.update).not.toHaveBeenCalled()
  })

  it('discard puts the saved values back', async () => {
    const user = userEvent.setup()
    mount('admin')
    const name = await screen.findByLabelText(/Legal name/)
    await user.type(name, ' Ltd')
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(name).toHaveValue('Q-Tech Solutions (Private) Limited')
  })

  for (const role of ['sales', 'engineer']) {
    it(`${role} reads the same record and cannot edit it`, async () => {
      mount(role)
      expect(await screen.findByText('Q-Tech Solutions (Private) Limited')).toBeInTheDocument()
      expect(screen.getByText('Only an admin can edit')).toBeInTheDocument()
      expect(screen.queryByRole('textbox')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
      expect(screen.getAllByText('Not set').length).toBeGreaterThan(0) // blank values are flagged, not empty
      expect(screen.queryByText(/Printed in the letterhead/)).toBeNull() // read-only view carries titles only
    })
  }

  it('non-admins are told to ask an admin when the profile is incomplete', async () => {
    h.row = EMPTY
    mount('sales')
    expect(await screen.findByText('Ask an admin to add them in Settings.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add them' })).toBeNull()
  })

  it('has no accessibility violations (admin form and read-only view)', async () => {
    const admin = mount('admin')
    await screen.findByLabelText(/Legal name/)
    expect(await axeViolations(screen.getByTestId('page'))).toEqual([])
    admin.unmount()
    mount('sales')
    await screen.findByText('Q-Tech Solutions (Private) Limited')
    expect(await axeViolations(screen.getByTestId('page'))).toEqual([])
  })
})
