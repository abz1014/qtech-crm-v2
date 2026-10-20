import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrderHeader } from '@/features/orders/api'
import { AddLineDialog } from '@/features/orders/AddDialogs'

const h = vi.hoisted(() => ({
  calls: [] as Array<{ id: string }>,
  release: null as null | (() => void),
  fail: false,
}))

vi.mock('@/ui/useToast', () => ({ useToast: () => ({ toast: () => {} }) }))
vi.mock('@/features/orders/hooks', () => ({
  // isPending stays false, as it is between the first tap and React's next render: only the lock can stop the second tap.
  useAddItem: () => ({
    isPending: false,
    mutateAsync: (l: { id: string }) => {
      h.calls.push(l)
      if (h.fail) return Promise.reject(Object.assign(new Error('Failed to fetch'), { code: '' }))
      return new Promise<void>(r => {
        h.release = r
      })
    },
  }),
  useAddLeg: () => ({ isPending: false, mutateAsync: () => Promise.resolve() }),
  useSupplierChoices: () => ({ data: [], isPending: false }),
}))

const order = { id: 'o1', number: 42, companyName: 'Punjab Cement' } as unknown as OrderHeader

async function fill() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Description'), 'Gasket kit')
  await user.type(screen.getByLabelText(/Unit price, net PKR/), '500')
  return screen.getByRole('button', { name: 'Add line' })
}

beforeEach(() => {
  h.calls = []
  h.release = null
  h.fail = false
})

describe('AddLineDialog (BUG-RV-07)', () => {
  it('a double tap sends one request, under a client-made id', async () => {
    const onClose = vi.fn()
    render(<AddLineDialog order={order} items={[]} legs={[]} onClose={onClose} />)
    const add = await fill()
    fireEvent.click(add)
    fireEvent.click(add)
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].id).toMatch(/^[0-9a-f-]{36}$/)
    h.release?.()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('a retry after a failed send reuses the same id, so the database can only keep one line', async () => {
    h.fail = true
    const onClose = vi.fn()
    render(<AddLineDialog order={order} items={[]} legs={[]} onClose={onClose} />)
    const add = await fill()
    fireEvent.click(add)
    await screen.findByText("Couldn't add the line")
    h.fail = false
    fireEvent.click(add)
    await waitFor(() => expect(h.calls).toHaveLength(2))
    expect(h.calls[1].id).toBe(h.calls[0].id)
    h.release?.()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
