import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDelete, type ConfirmDeleteProps } from '@/ui/ConfirmDelete'

afterEach(cleanup)

function open(props: Partial<ConfirmDeleteProps> = {}) {
  const onOpenChange = vi.fn()
  const onConfirm = vi.fn().mockResolvedValue(undefined)
  render(
    <ConfirmDelete
      open
      onOpenChange={onOpenChange}
      thing="RFQ-0177"
      summary="RFQ-0177 · Indus Textile Mills"
      onConfirm={onConfirm}
      {...props}
    />,
  )
  return { onOpenChange, onConfirm }
}

describe('ConfirmDelete', () => {
  it('names the thing, the summary, what else goes with it and that it cannot be undone', () => {
    open({ also: ['2 issued quotations (QT-26-0012 R0, R1)', '5 supplier prices', '3 files'] })
    expect(screen.getByRole('dialog', { name: 'Delete RFQ-0177?' })).toBeInTheDocument()
    expect(screen.getByText('RFQ-0177 · Indus Textile Mills')).toBeInTheDocument()
    expect(screen.getByText(/Also deletes:/).parentElement).toHaveTextContent(
      'Also deletes: 2 issued quotations (QT-26-0012 R0, R1), 5 supplier prices, 3 files',
    )
    expect(screen.getByText('This can’t be undone.')).toBeInTheDocument()
  })

  it('leaves the also line out when nothing else goes', () => {
    open({ also: [] })
    expect(screen.queryByText(/Also deletes/)).toBeNull()
  })

  it('Delete is a red (danger) button, never the green primary one; Cancel closes without deleting', async () => {
    const { onConfirm, onOpenChange } = open()
    const del = screen.getByRole('button', { name: 'Delete' })
    expect(del.className).toContain('bg-tone-danger-fg')
    expect(del.className).not.toContain('bg-primary')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('runs the action at once, closes when it resolves', async () => {
    const { onConfirm, onOpenChange } = open()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('a double click runs it once and the button is busy meanwhile', async () => {
    let finish!: () => void
    const onConfirm = vi.fn(() => new Promise<void>(r => (finish = r)))
    open({ onConfirm })
    const del = screen.getByRole('button', { name: 'Delete' })
    await userEvent.dblClick(del)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /Deleting/ })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    finish()
    await waitFor(() => expect(screen.queryByRole('button', { name: /Deleting/ })).toBeNull())
  })

  it('shows the server sentence on a failure, stays open, and can be tried again', async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce({
        code: 'P0001',
        message: 'This RFQ has an order. Delete the order first, then delete the RFQ.',
        hint: 'has_order',
      })
      .mockResolvedValue(undefined)
    const { onOpenChange } = open({ onConfirm })
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This RFQ has an order. Delete the order first, then delete the RFQ.')
    expect(onOpenChange).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })

  it('waits for the counts: Delete is disabled while loading', () => {
    open({ loading: true })
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(screen.getByText(/Checking what goes with it/)).toBeInTheDocument()
  })

  it('blocked: shows the reason, no Delete button, and never runs the action', async () => {
    const { onConfirm } = open({ blocked: 'Has order ORD-0038. Delete or cancel the order first.' })
    expect(screen.getByRole('alert')).toHaveTextContent('Has order ORD-0038. Delete or cancel the order first.')
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.queryByText('This can’t be undone.')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
