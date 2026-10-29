import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/ui/Toast'
import { installFakeDb, opArgs } from '@/test/fakeSupabase'
import { header } from '@/features/orders/lib/stepFixtures'
import { VisitDialog } from '@/features/orders/VisitDialog'

let fake: ReturnType<typeof installFakeDb> | null = null
afterEach(() => fake?.uninstall())

function open() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <ToastProvider>
        <VisitDialog order={header()} onClose={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('Visit type', () => {
  it('saves the type on the order, and no time', async () => {
    fake = installFakeDb(() => ({ data: null }))
    open()
    fireEvent.change(screen.getByRole('combobox', { name: /Visit type/ }), { target: { value: 'survey' } })
    expect(document.querySelector('input[type="time"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fake?.calls.some(c => c.verb === 'update')).toBe(true))
    const call = fake!.calls.find(c => c.verb === 'update')!
    expect(call.target).toBe('orders')
    expect(opArgs(call, 'update')?.[0]).toEqual({ visit_type: 'survey' })
  })

  it('says in plain words when the person is not assigned to the site', async () => {
    fake = installFakeDb(() => ({
      error: { code: '42501', message: 'Only an engineer assigned to this order can set its visit time or type.', hint: 'not_assigned' },
    }))
    open()
    fireEvent.change(screen.getByRole('combobox', { name: /Visit type/ }), { target: { value: 'survey' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('only on a site assigned to you')
  })
})
