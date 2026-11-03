import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { TapText } from '@/features/orders/TapEdit'

describe('TapText when the save does not go through', () => {
  it('stays open with what was typed when onSave answers false', async () => {
    const user = userEvent.setup()
    render(<TapText value="PO-1" label="Customer PO number" empty="add" onSave={async () => false} />)
    await user.click(screen.getByRole('button', { name: /Customer PO number/ }))
    const box = screen.getByRole('textbox', { name: 'Customer PO number' })
    await user.clear(box)
    await user.type(box, 'PO-2')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('textbox', { name: 'Customer PO number' })).toHaveValue('PO-2')
  })

  it('closes when onSave answers nothing, as before', async () => {
    const user = userEvent.setup()
    render(<TapText value="PO-1" label="Customer PO number" empty="add" onSave={async () => {}} />)
    await user.click(screen.getByRole('button', { name: /Customer PO number/ }))
    const box = screen.getByRole('textbox', { name: 'Customer PO number' })
    await user.clear(box)
    await user.type(box, 'PO-2')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await later()
    expect(screen.queryByRole('textbox', { name: 'Customer PO number' })).toBeNull()
  })
})

const later = () => new Promise(r => setTimeout(r, 50))
