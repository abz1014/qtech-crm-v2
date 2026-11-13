import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionContext } from '@/app/session'
import type { AttachmentRow } from '@/features/rfqs/api'
import { AttachmentItem } from '@/features/rfqs/FileBits'
import { AttachmentsPanel } from '@/features/rfqs/AttachmentsPanel'
import { FileRow } from '@/ui/form/FileRow'
import { ToastProvider } from '@/ui/Toast'

vi.mock('@/features/rfqs/hooks', () => ({
  useDeleteAttachment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOrderAttachments: () => ({ data: [], isSuccess: true, isPending: false, isError: false }),
  useRfqAttachments: () => ({ data: [], isSuccess: true, isPending: false, isError: false }),
  useClarifications: () => ({ data: [] }),
  useUploadAttachment: () => ({ mutateAsync: vi.fn() }),
  useFileUrls: () => ({ data: {} }),
  useSetAttachmentHasPrices: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/features/rfqs/HasPricesToggle', () => ({ HasPricesToggle: () => null }))

afterEach(cleanup)

const LONG = 'Customer_purchase_order_for_the_boiler_feed_pump_overhaul_final_signed_version_2_scanned.pdf'
const att = { id: 'a1', path: 'p/a1.pdf', fileName: LONG, mimeType: 'application/pdf', sizeBytes: 2048, hasPrices: false, clarificationId: null } as unknown as AttachmentRow

function as(role: string, ui: React.ReactNode) {
  return render(
    <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Bilal', role } }}>
      <ToastProvider>{ui}</ToastProvider>
    </SessionContext.Provider>,
  )
}

describe('file rows and the Files panel wording', () => {
  it('a long file name wraps (no truncate) and carries the full name as its title', () => {
    as('admin', <AttachmentItem rfqId="r1" att={att} url={undefined} />)
    const name = screen.getByText(LONG, { selector: 'b' })
    expect(name).toHaveAttribute('title', LONG)
    expect(name.className).not.toMatch(/\btruncate\b/)
    expect(name.className).toMatch(/break-words/)
  })

  it('FileRow wraps a long name too and titles it', () => {
    render(<FileRow item={{ id: 'f', file: new File(['x'], LONG, { type: 'application/pdf' }), originalSize: 1 } as never} />)
    const name = screen.getByText(LONG)
    expect(name).toHaveAttribute('title', LONG)
    expect(name.className).not.toMatch(/\btruncate\b/)
  })

  it('deleting a file on an order talks about the order, on an RFQ about the RFQ', async () => {
    const user = userEvent.setup()
    const order = as('admin', <AttachmentItem orderId="o1" att={att} url={undefined} />)
    await user.click(screen.getByRole('button', { name: `Delete ${LONG}` }))
    expect(screen.getByText(/removed from this order/)).toBeInTheDocument()
    expect(screen.queryByText(/this RFQ/)).toBeNull()
    order.unmount()
    as('admin', <AttachmentItem rfqId="r1" att={att} url={undefined} />)
    await user.click(screen.getByRole('button', { name: `Delete ${LONG}` }))
    expect(screen.getByText(/removed from this RFQ/)).toBeInTheDocument()
  })

  it('the empty order Files panel says "PO" to admin and sales, never to an engineer', () => {
    const admin = as('admin', <AttachmentsPanel orderId="o1" />)
    expect(screen.getByText(/customer’s PO/)).toBeInTheDocument()
    admin.unmount()
    as('engineer', <AttachmentsPanel orderId="o1" />)
    expect(screen.getByText(/No files yet/)).toBeInTheDocument()
    expect(screen.queryByText(/\bPO\b/)).toBeNull()
  })
})
