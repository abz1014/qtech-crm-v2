import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Send } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { axeViolations } from '@/test/axe'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent, DialogTrigger } from '@/ui/Dialog'

function Demo({ busy = false, withField = true, trigger = true }: { busy?: boolean; withField?: boolean; trigger?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open programmatically</Button>
      <Dialog open={open} onOpenChange={setOpen} busy={busy}>
        {trigger ? (
          <DialogTrigger asChild>
            <Button>Mark as floated</Button>
          </DialogTrigger>
        ) : null}
        <DialogContent
          title="Mark as floated"
          context="RFQ-0177 · Indus Textile Mills"
          icon={Send}
          tone="info"
          footer={
            <>
              <Button data-cancel onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary">Mark as floated</Button>
            </>
          }
        >
          <p>Four suppliers on the shortlist will be marked as sent today.</p>
          {withField ? <input aria-label="Note" /> : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

describe('Dialog (U03)', () => {
  it('is labelled by its title and described by its context line', async () => {
    const user = userEvent.setup()
    render(<Demo />)
    await user.click(screen.getByRole('button', { name: 'Mark as floated' }))
    const dlg = await screen.findByRole('dialog', { name: 'Mark as floated' })
    expect(dlg).toHaveAccessibleDescription('RFQ-0177 · Indus Textile Mills')
  })

  it('has no axe violations while open', async () => {
    const user = userEvent.setup()
    render(<Demo />)
    await user.click(screen.getByRole('button', { name: 'Mark as floated' }))
    await screen.findByRole('dialog')
    expect(await axeViolations()).toEqual([])
  })

  it('keyboard: focus moves to the first field, Tab and Shift+Tab stay inside, Esc closes and returns focus to the opener', async () => {
    const user = userEvent.setup()
    render(<Demo />)
    const opener = screen.getByRole('button', { name: 'Mark as floated' })
    opener.focus()
    await user.keyboard('{Enter}')
    const dlg = await screen.findByRole('dialog')
    await waitFor(() => expect(screen.getByLabelText('Note')).toHaveFocus())

    // Tab through every tabbable control, many times: focus never leaves the dialog.
    for (let i = 0; i < 8; i++) {
      await user.tab()
      expect(dlg.contains(document.activeElement)).toBe(true)
    }
    for (let i = 0; i < 8; i++) {
      await user.tab({ shift: true })
      expect(dlg.contains(document.activeElement)).toBe(true)
    }

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(opener).toHaveFocus()
  })

  it('the close button closes it and returns focus to the opener', async () => {
    const user = userEvent.setup()
    render(<Demo />)
    const opener = screen.getByRole('button', { name: 'Mark as floated' })
    await user.click(opener)
    await user.click(await screen.findByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(opener).toHaveFocus()
  })

  it('opened from code, focus still returns to the element that had it', async () => {
    const user = userEvent.setup()
    render(<Demo trigger={false} />)
    const opener = screen.getByRole('button', { name: 'Open programmatically' })
    await user.click(opener)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(opener).toHaveFocus()
  })

  it('a confirm with no field puts focus on Cancel, the least destructive button', async () => {
    const user = userEvent.setup()
    render(<Demo withField={false} />)
    await user.click(screen.getByRole('button', { name: 'Mark as floated' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
  })

  it('while busy, Esc and the close button are ignored', async () => {
    const user = userEvent.setup()
    render(<Demo busy />)
    await user.click(screen.getByRole('button', { name: 'Mark as floated' }))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
  })
})
