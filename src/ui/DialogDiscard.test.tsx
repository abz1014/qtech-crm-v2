import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { axeViolations } from '@/test/axe'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Form, FormField } from '@/ui/form/Form'
import { TextField } from '@/ui/form/TextField'
import { useSubmitForm } from '@/ui/form/useSubmitForm'

function DirtyDemo() {
  const [open, setOpen] = useState(true)
  const [text, setText] = useState('')
  return (
    <Dialog open={open} onOpenChange={setOpen} dirty={text !== ''}>
      <DialogContent
        title="Paste reply"
        footer={
          <>
            <Button data-cancel onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Save
            </Button>
          </>
        }
      >
        <textarea aria-label="Reply" value={text} onChange={e => setText(e.target.value)} />
      </DialogContent>
    </Dialog>
  )
}

function FormDemo() {
  const [open, setOpen] = useState(true)
  const sf = useSubmitForm({ schema: z.object({ name: z.string() }), defaultValues: { name: '' }, onSubmit: () => undefined })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Add person" footer={<Button data-cancel onClick={() => setOpen(false)}>Cancel</Button>}>
        <Form sf={sf}>
          <FormField name="name" label="Name">
            {f => <TextField {...f} />}
          </FormField>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

describe('Dialog discard guard (learnability 3.3)', () => {
  it('closes at once when nothing was typed', async () => {
    const user = userEvent.setup()
    render(<DirtyDemo />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('Cancel and Esc ask first; Keep editing keeps the text, Discard closes', async () => {
    const user = userEvent.setup()
    render(<DirtyDemo />)
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'USD 120')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('group', { name: 'Discard what you typed?' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep editing' }))
    expect(await axeViolations()).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('group', { name: 'Discard what you typed?' })).toBeNull()
    expect((screen.getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement).value).toBe('USD 120')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('a save that closes the dialog itself is not asked', async () => {
    const user = userEvent.setup()
    render(<DirtyDemo />)
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'x')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('a Form inside reports its changes without a prop', async () => {
    const user = userEvent.setup()
    render(<FormDemo />)
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Ali')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('group', { name: 'Discard what you typed?' })).toBeTruthy()
  })

  it('desktop Back asks first once something was typed, and leaves a clean dialog alone (HW-34)', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '')
    render(<DirtyDemo />)
    await new Promise(r => setTimeout(r, 0))
    expect(window.history.state).toBeNull() // a desktop without typing: no history entry, Back keeps its meaning
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'USD 120')
    await waitFor(() => expect(window.history.state).not.toBeNull())
    window.history.back()
    await waitFor(() => expect(screen.getByRole('group', { name: 'Discard what you typed?' })).toBeTruthy())
    expect((screen.getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement).value).toBe('USD 120')
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
