import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as RadixDialog from '@radix-ui/react-dialog'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { ToastProvider } from '@/ui/Toast'
import { useToast, type ToastInput } from '@/ui/useToast'

/*
 * Review 24 Nov, screen 10: a "Reopened" toast sat on Mark won's Cancel and Mark won, an error toast on the supplier reply's Save,
 * and a 300-character company name filled a phone screen. While a dialog is open the toasts go to the top; the words are clamped;
 * an error raised behind a modal dialog is still announced and the dialog keeps focus.
 */
function Fire({ input }: { input: ToastInput }) {
  const { toast } = useToast()
  return (
    <button type="button" onClick={() => toast(input)}>
      Fire
    </button>
  )
}

function WithDialog({ input }: { input: ToastInput }) {
  const [open, setOpen] = useState(false)
  return (
    <ToastProvider>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <RadixDialog.Root open={open} onOpenChange={setOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Content aria-describedby={undefined}>
            <RadixDialog.Title>Mark won</RadixDialog.Title>
            <Fire input={input} />
            <button type="button">Mark won</button>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
    </ToastProvider>
  )
}

const region = () => screen.getByRole('region', { name: 'Notifications', hidden: true })

describe('Toast placement and length (review 24 Nov)', () => {
  it('sits at the bottom right with no dialog open', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <Fire input={{ title: 'Reopened', body: 'RFQ-0013 is open again' }} />
      </ToastProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Fire' }))
    await screen.findByText('Reopened')
    expect(region()).not.toHaveAttribute('data-over-dialog')
    expect(region().className).toMatch(/(^| )bottom-4( |$)/)
    expect(region().className).not.toMatch(/(^| )top-4( |$)/)
  })

  it('moves to the top on every width while a dialog is open, keeps Undo, and the dialog keeps focus', async () => {
    const user = userEvent.setup()
    render(<WithDialog input={{ title: 'Reopened', body: 'RFQ-0013 is open again', undo: { onUndo: () => {} } }} />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    const fire = await screen.findByRole('button', { name: 'Fire' })
    await user.click(fire)
    await screen.findByText('Reopened')
    await waitFor(() => expect(region()).toHaveAttribute('data-over-dialog', 'true'))
    const cls = region().className
    expect(cls).toMatch(/(^| )top-4( |$)/)
    expect(cls).not.toMatch(/(^| )bottom-4( |$)/)
    expect(cls).toContain('max-md:top-')
    expect(screen.getByRole('button', { name: /Undo/, hidden: true })).toBeInTheDocument()
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })

  it('an error raised behind a modal dialog is not hidden from screen readers', async () => {
    const user = userEvent.setup()
    render(<WithDialog input={{ title: 'Could not save the reply', tone: 'danger' }} />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(await screen.findByRole('button', { name: 'Fire' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not save the reply')
    // Radix hides everything outside the dialog with aria-hidden, except elements carrying aria-live.
    expect(region()).toHaveAttribute('aria-live', 'off')
    expect(region().closest('[aria-hidden="true"]')).toBeNull()
  })

  it('clamps a very long title and body so a toast never fills a phone screen', async () => {
    const user = userEvent.setup()
    const name = 'Company '.repeat(40).trim()
    render(
      <ToastProvider>
        <Fire input={{ title: `Saved ${name}`, body: `Customer ${name}` }} />
      </ToastProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Fire' }))
    const title = await screen.findByText(`Saved ${name}`)
    expect(title).toHaveClass('line-clamp-2')
    expect(screen.getByText(`Customer ${name}`)).toHaveClass('line-clamp-3')
    // the full words stay in the page for a screen reader
    expect(screen.getByRole('status')).toHaveTextContent(`Customer ${name}`)
  })
})

/*
 * Review 25 Nov: at the top centre a toast covered the top of Mark won (its title and the quotation chip). The toasts now keep clear
 * of the dialog itself: above it when it leaves room, beside it on a wide screen, else the dialog moves down below them.
 * jsdom has no layout, so the window and the dialog's box are set here.
 */
function rect(top: number, left: number, width: number, height: number): DOMRect {
  return { top, left, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

function MarkWon({ input }: { input: ToastInput }) {
  return (
    <ToastProvider>
      <Dialog open onOpenChange={() => {}}>
        <DialogContent title="Mark won" footer={<button type="button">Mark won</button>}>
          <Fire input={input} />
        </DialogContent>
      </Dialog>
    </ToastProvider>
  )
}

async function fireInDialog(box: DOMRect, width: number, toastHeight = 64) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-toast-room-panel') ? box : rect(0, 0, 0, 0)
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('aria-label') === 'Notifications' ? toastHeight : 0
  })
  const user = userEvent.setup()
  render(<MarkWon input={{ title: 'Reopened', body: 'RFQ-0013 is open again' }} />)
  await user.click(await screen.findByRole('button', { name: 'Fire' }))
  await screen.findByText('Reopened')
  await waitFor(() => expect(region()).toHaveAttribute('data-over-dialog', 'true'))
}

describe('Toasts keep clear of an open dialog (review 25 Nov)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.documentElement.removeAttribute('data-toast-room')
    document.documentElement.style.removeProperty('--toast-room')
  })

  it('stay at the top when the dialog starts below them', async () => {
    await fireInDialog(rect(200, 340, 760, 500), 1440)
    expect(region()).not.toHaveAttribute('data-beside-dialog')
    expect(document.documentElement).not.toHaveAttribute('data-toast-room')
    expect(region().className).toMatch(/(^| )top-4( |$)/)
  })

  it('move beside a tall dialog on a wide screen, never over it', async () => {
    // 1440 wide, a 760 dialog from 340 to 1100 that starts 32 px from the top: 340 px free on each side
    await fireInDialog(rect(32, 340, 760, 836), 1440)
    await waitFor(() => expect(region()).toHaveAttribute('data-beside-dialog', 'right'))
    const style = region().style
    expect(style.right).toBe('16px')
    expect(style.top).toBe('16px')
    expect(style.width).toBe('308px')
    // the toast column (1440 - 16 - 308 = 1116 onwards) starts right of the dialog's edge (1100)
    expect(1440 - 16 - 308).toBeGreaterThan(1100)
    expect(document.documentElement).not.toHaveAttribute('data-toast-room')
  })

  it('with no room above or beside, the dialog makes room: a strip at the top as tall as the toasts', async () => {
    await fireInDialog(rect(32, 104, 560, 836), 768)
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-toast-room'))
    // 16 from the top, a 64 px toast, an 8 px gap
    expect(document.documentElement.style.getPropertyValue('--toast-room')).toBe('88px')
    expect(region()).not.toHaveAttribute('data-beside-dialog')
    expect(document.querySelector('[data-toast-room-overlay]')).not.toBeNull()
  })

  it('gives the room back when the toast goes', async () => {
    await fireInDialog(rect(32, 104, 560, 836), 768)
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-toast-room'))
    // the modal dialog turns pointer events off outside it (Radix), so the click is sent straight to the button
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss', hidden: true }))
    await waitFor(() => expect(document.documentElement).not.toHaveAttribute('data-toast-room'))
    expect(document.documentElement.style.getPropertyValue('--toast-room')).toBe('')
  })
})
