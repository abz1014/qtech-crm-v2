import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionContext, type SessionState } from '@/app/session'
import NewEnquiryPage from '@/features/enquiry/NewEnquiryPage'
import { installFakeDb, opArgs, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/* New enquiry (P4-A): the document on one side, the existing intake on the other, "Create job N" as the one green button. */
const EMAIL = ['Dear Sir, please quote:', '1) Hach HQ1110 portable meter - 1 no', '2) 24V actuator for ball valve x 2', 'Regards, K'].join('\n')

function respond(call: FakeCall): FakeResult {
  const has = (op: string) => call.ops.some(([n]) => n === op)
  switch (call.target) {
    case 'brands':
      return { data: [{ id: 'b-hach', name: 'Hach', kind: 'brand' }] }
    case 'companies':
      return has('ilike') ? { data: [{ id: 'c-acme', name: 'Acme Plastics', country: 'Pakistan' }] } : { data: [] }
    case 'rpc:float_rfq':
      return { data: 'rfq-id' }
    case 'rfqs':
      // the highest RFQ number (for "Create job N"), and the saved one the RFQ id resolves to
      if (has('order')) return { data: [{ number: 161 }] }
      return { data: { id: 'rfq-id', number: 162 } }
    default:
      return { data: [] }
  }
}

const SIGNED_IN: SessionState = { status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role: 'sales' } }

function renderPage(entry: string | { pathname: string; state?: unknown } = '/enquiries/new') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={SIGNED_IN}>
        <MemoryRouter initialEntries={[entry]}>
          <ToastProvider>
            <Routes>
              <Route path="/enquiries/new" element={<NewEnquiryPage />} />
              <Route path="/jobs/:key" element={<h1>The job page</h1>} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  installFakeDb(() => ({})).uninstall()
})

describe('New enquiry', () => {
  it('offers a drop zone first, and the intake beside it with "Create job N"', async () => {
    installFakeDb(respond)
    renderPage()
    expect(screen.getByTestId('enquiry-dropzone')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'New enquiry', level: 1 })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Create job 162' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Looks right: find suppliers' })).toBeNull()
  })

  it('a photo chosen with the Choose PDF or photo button in the intake is shown on the left too, like a dropped file', async () => {
    installFakeDb(respond)
    const user = userEvent.setup()
    renderPage()
    expect(screen.queryByTestId('source-file')).toBeNull()
    const file = new File(['x'], 'site-enquiry.jpg', { type: 'image/jpeg' })
    await user.upload(await screen.findByTestId('pdf-input-items'), file)
    expect(await screen.findByTestId('source-file')).toHaveTextContent('site-enquiry.jpg')
    expect(screen.queryByTestId('enquiry-dropzone')).toBeNull()
  })

  it('a file chosen on the drop zone is shown on the left and handed to the intake', async () => {
    installFakeDb(respond)
    const user = userEvent.setup()
    renderPage()
    const file = new File(['%PDF-1.4'], 'enquiry.pdf', { type: 'application/pdf' })
    await user.upload(screen.getByTestId('enquiry-file-input'), file)
    expect(await screen.findByTestId('source-file')).toHaveTextContent('enquiry.pdf')
    expect(screen.queryByTestId('enquiry-dropzone')).toBeNull()
  })

  it('a pasted message is mirrored on the left, and Create job saves it without asking anyone, then opens the job', async () => {
    const db = installFakeDb(respond)
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByRole('combobox', { name: 'Company' }), 'Acme')
    await user.click(await screen.findByRole('option', { name: /Acme Plastics/ }))
    fireEvent.paste(document.body, { clipboardData: { getData: () => EMAIL } })
    expect(await screen.findByText('2 items found')).toBeInTheDocument()
    expect(screen.getByTestId('source-text')).toHaveTextContent('Hach HQ1110 portable meter')
    expect(screen.getByText(/Check this: split from the document/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create job 162' }))
    await waitFor(() => expect(db.calls.some(c => c.target === 'rpc:float_rfq')).toBe(true))
    const args = opArgs(db.calls.find(c => c.target === 'rpc:float_rfq') as FakeCall, 'args')?.[0] as { p_mark_sent?: boolean; p_supplier_ids?: string[] }
    expect(args.p_mark_sent ?? false).toBe(false)
    expect(await screen.findByRole('heading', { name: 'The job page' })).toBeInTheDocument()
  })
})
