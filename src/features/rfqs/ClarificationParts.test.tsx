import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { AddQuestions } from '@/features/rfqs/ClarificationParts'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { axeViolations } from '@/test/axe'
import { ToastProvider } from '@/ui/Toast'

/*
 * Adding questions by paste (R09), with a scripted database: the paste splits into one row per line, each can be tagged to
 * the supplier who asked, and one tap writes them all in a single insert. The real insert, RLS and the stamps are proven
 * against the real database by the Playwright `rfq-detail` project (clarifications.spec.ts).
 */

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

function setup(inquiries: { id: string; name: string }[]) {
  const writes: FakeCall[] = []
  const db = installFakeDb(call => {
    if (call.target === 'clarifications') writes.push(call)
    return { data: [] }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AddQuestions rfqId="r-1" inquiries={inquiries} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { db, writes, ...view }
}

describe('AddQuestions', () => {
  it('a paste becomes one question per line, and one tap adds them all with the tag chosen', async () => {
    const user = userEvent.setup()
    const { writes, container } = setup([{ id: 'i-lpc', name: 'Lahore Process Controls' }])
    // One line until tapped: no paste box yet (grade-B R9).
    expect(screen.queryByRole('textbox', { name: 'Add questions' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Add question' }))
    expect(screen.getByRole('button', { name: 'Add question' })).toBeDisabled()
    await user.click(screen.getByRole('textbox', { name: 'Add questions' }))
    await user.paste('1. What flange size?\n2. HART or plain 4-20 mA?\n\n3) Is Ex certification needed?')
    const list = screen.getByRole('list', { name: 'Questions to add' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    await user.selectOptions(screen.getByLabelText('Who asked: HART or plain 4-20 mA?'), 'i-lpc')
    await user.click(screen.getByRole('button', { name: 'Leave out: Is Ex certification needed?' }))
    expect(await axeViolations(container)).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Add 2 questions' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    const rows = opArgs(writes[0], 'upsert')?.[0] as Array<{ question: string; raised_by_inquiry_id: string | null; rfq_id: string; id: string }>
    expect(rows.map(r => [r.question, r.raised_by_inquiry_id, r.rfq_id])).toEqual([
      ['What flange size?', null, 'r-1'],
      ['HART or plain 4-20 mA?', 'i-lpc', 'r-1'],
    ])
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/)
    // Added: the box closes back to its one line.
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Add questions' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Add question' })).toBeEnabled()
  })

  it('with no supplier asked there is no tag to choose', async () => {
    const user = userEvent.setup()
    setup([])
    await user.click(screen.getByRole('button', { name: 'Add question' }))
    await user.click(screen.getByRole('textbox', { name: 'Add questions' }))
    await user.paste('Which probe kit?')
    expect(screen.queryByLabelText(/Who asked/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Add question' })).toBeEnabled()
  })
})
