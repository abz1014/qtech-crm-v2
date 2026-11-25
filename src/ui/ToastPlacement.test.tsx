import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as RadixDialog from '@radix-ui/react-dialog'
import { describe, expect, it } from 'vitest'
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
