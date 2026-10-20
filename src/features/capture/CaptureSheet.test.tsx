import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CaptureSheet from '@/features/capture/CaptureSheet'
import { SavedPanel } from '@/features/capture/CaptureParts'
import { CaptureContext, type CaptureApi, type Draft } from '@/app/capture/useCapture'
import { SessionContext } from '@/app/session'
import { ToastContext } from '@/ui/useToast'
import type { Candidate } from '@/features/capture/model'

const capApi = vi.hoisted(() => ({
  listCandidates: vi.fn(),
  getRfqNotes: vi.fn(),
  setRfqNotes: vi.fn(),
  listOrderCandidates: vi.fn(async () => []),
  getOrderNotes: vi.fn(),
  setOrderNotes: vi.fn(),
}))
vi.mock('@/features/capture/api', () => capApi)

const rfqApi = vi.hoisted(() => ({
  uploadAttachment: vi.fn(),
  addClarifications: vi.fn(),
  deleteAttachment: vi.fn(),
  listClarifications: vi.fn(async () => []),
  setClarificationAnswer: vi.fn(),
  setClarificationWithdrawn: vi.fn(),
}))
vi.mock('@/features/rfqs/api', async importOriginal => ({ ...(await importOriginal<object>()), ...rfqApi }))

const RFQ: Candidate = { id: 'rfq-1', number: 177, companyName: 'Acme', ownerId: 'u1', city: null, openedAt: Date.now(), open: [] }
const photo = { id: 'f1', file: new File(['x'], 'a.jpg', { type: 'image/jpeg' }), originalSize: 1 }

function show(draft: Draft) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const cap: CaptureApi = {
    open: true,
    draft,
    notice: null,
    dragging: 0,
    resizing: [],
    openCapture: vi.fn(),
    close: vi.fn(),
    setText: vi.fn(),
    add: vi.fn(),
    removeFile: vi.fn(),
    discard: vi.fn(),
    openShared: vi.fn(),
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ayesha', role: 'sales' } }}>
          <ToastContext.Provider value={{ toast: vi.fn(() => 't'), dismiss: vi.fn() }}>
            <CaptureContext.Provider value={cap}>
              <CaptureSheet />
            </CaptureContext.Provider>
          </ToastContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { client, cap }
}

beforeEach(() => {
  vi.clearAllMocks()
  capApi.listCandidates.mockResolvedValue([RFQ])
  rfqApi.addClarifications.mockResolvedValue(2)
  rfqApi.uploadAttachment.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ id: 'att-1', path: 'rfq-1/x.jpg' })
})

describe('Capture sheet: a retry after a half-done save does not write twice', () => {
  it('adds each question once when the file upload failed and Try again is pressed', async () => {
    show({ id: 'd1', source: 'paste', text: 'Line size?\nFlange rating?', files: [photo] })
    const save = await screen.findByRole('button', { name: 'Add 2 questions' })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.click(save)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(rfqApi.uploadAttachment).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull())
    const ids = new Set(rfqApi.addClarifications.mock.calls.flatMap(([, qs]) => (qs as { id: string }[]).map(q => q.id)))
    expect(ids.size).toBe(2)
  })

  it('appends the note once when the file upload failed and Try again is pressed', async () => {
    let notes = null as string | null
    capApi.getRfqNotes.mockImplementation(async () => notes)
    capApi.setRfqNotes.mockImplementation(async (_id: string, n: string | null) => void (notes = n))
    show({ id: 'd1', source: 'paste', text: 'Fluid is hot water', files: [photo] })
    const save = await screen.findByRole('button', { name: 'Add to notes' })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.click(save)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(rfqApi.uploadAttachment).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull())
    expect(notes?.match(/Fluid is hot water/g)).toHaveLength(1)
  })
})

describe('Capture sheet: a button that cannot go yet says why (owner test 2026-10-20)', () => {
  it('Continue to New RFQ needs no company: a PDF on its own goes straight on', async () => {
    const pdf = { id: 'f2', file: new File(['%PDF-1.4'], 'enquiry.pdf', { type: 'application/pdf' }), originalSize: 8 }
    const { cap } = show({ id: 'd1', source: 'drop', text: '', files: [pdf] })
    // Only the chosen option shows; Something else opens the rest (R2-11).
    fireEvent.click(await screen.findByRole('button', { name: 'Something else' }))
    fireEvent.click(await screen.findByRole('radio', { name: /Start a new RFQ/ }))
    const go = screen.getByRole('button', { name: 'Continue to New RFQ' })
    expect(go).toBeEnabled()
    expect(screen.queryByTestId('capture-why')).toBeNull()
    fireEvent.click(go)
    await waitFor(() => expect(cap.close).toHaveBeenCalled())
  })

  it('offline: the button is disabled and the reason is beside it', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    show({ id: 'd1', source: 'paste', text: 'Fluid is hot water', files: [] })
    expect(await screen.findByTestId('capture-why')).toHaveTextContent('You’re offline')
    online.mockRestore()
  })
})

describe('Capture sheet: after a save the RFQs on offer are read again', () => {
  it('refetches the candidate list (answered questions must not be offered again)', async () => {
    rfqApi.uploadAttachment.mockReset().mockResolvedValue({ id: 'att-1', path: 'rfq-1/x.jpg' })
    capApi.getRfqNotes.mockResolvedValue(null)
    capApi.setRfqNotes.mockResolvedValue(undefined)
    show({ id: 'd1', source: 'paste', text: 'Fluid is hot water', files: [] })
    const save = await screen.findByRole('button', { name: 'Add to notes' })
    await waitFor(() => expect(save).toBeEnabled())
    expect(capApi.listCandidates).toHaveBeenCalledTimes(1)
    fireEvent.click(save)
    await waitFor(() => expect(capApi.setRfqNotes).toHaveBeenCalled())
    await waitFor(() => expect(capApi.listCandidates).toHaveBeenCalledTimes(2))
  })
})

describe('Capture sheet: only the chosen option shows (R2-11)', () => {
  it('draws the chosen tile alone; Something else opens the other three and the reply and order choices', async () => {
    show({ id: 'd1', source: 'paste', text: 'Fluid is hot water', files: [] })
    const group = await screen.findByRole('radiogroup', { name: 'What should we do with it' })
    await waitFor(() => expect(within(group).getAllByRole('radio')).toHaveLength(1))
    expect(within(group).getByRole('radio')).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Attach to an order' })).toBeNull()
    const more = screen.getByRole('button', { name: 'Something else' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(within(screen.getByRole('radiogroup', { name: 'What should we do with it' })).getAllByRole('radio')).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'Attach to an order' })).toBeInTheDocument()
  })

  it('the saved answer says what happens next in one sentence, not two chips', () => {
    render(
      <SavedPanel title="Saved to RFQ-0177" summary="2 questions answered." rfq="RFQ-0177 · Acme" answered={2}>
        <button type="button">Done</button>
      </SavedPanel>,
    )
    expect(screen.getByText(/Marks/)).toHaveTextContent('Marks 2 questions answered. Next: send the answers to the suppliers.')
  })
})
