import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { ToastProvider } from '@/ui/Toast'
import CaptureRoute from '@/features/capture/CaptureRoute'

/*
 * /capture with no ?share (the engineer's "Photo or note" button) asks which job; it must not say "Nothing to add" and must not pick up an old kept share.
 */
vi.mock('@/lib/capture/store', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/capture/store')>()
  const old = { id: 'old', source: 'share', text: 'old share', files: [], createdAt: 0, expiresAt: 1e15 }
  return { ...real, listCaptures: () => Promise.resolve([old]), getCapture: (id: string) => Promise.resolve(id === 'old' ? old : null), deleteCapture: vi.fn() }
})
const job = (key: string, over: Record<string, unknown> = {}) => ({
  key, kind: 'order', rfqId: null, orderId: null, companyId: 'c', companyName: `Company ${key}`, siteName: null, ownerId: 'someone', ownerName: null,
  items: `Part of ${key}`, stage: 'work', stageDetail: null, isHistory: false, lastActivityOn: '2026-10-01', repeatOf: null, cancelledOrders: 0, engineerIds: [], ...over,
})
vi.mock('@/features/jobs/hooks', () => ({
  useJobsList: () => ({
    isPending: false,
    isError: false,
    data: [
      job('201', { engineerIds: ['u1'], lastActivityOn: '2026-10-05', items: 'Flowmeter +2 more' }),
      job('202', { engineerIds: ['u1'], lastActivityOn: '2026-10-09' }),
      job('203', { engineerIds: ['other'] }),
      job('204', { engineerIds: ['u1'], isHistory: true }),
    ],
  }),
  useJobSearch: (q: string) => ({ isPending: false, data: q.trim() ? [{ key: '139', companyName: 'Harbour Textiles Limited', items: 'Flowmeter' }] : [] }),
}))

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search + JSON.stringify(l.state)}</p>
}

describe('Capture route: Photo or note with nothing shared', () => {
  it('asks which job, shows no "Nothing to add", and opens the job with the photo-or-note box requested', async () => {
    const user = userEvent.setup()
    render(
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ali', role: 'engineer' } }}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/capture']}>
            <Routes>
              <Route path="/capture" element={<CaptureRoute />} />
              <Route path="/jobs/*" element={<Where />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </SessionProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Photo or note' })).toBeInTheDocument()
    expect(screen.queryByText('Nothing to add')).toBeNull()
    expect(screen.queryByTestId('share-target')).toBeNull()
    await user.type(screen.getByLabelText('Find the job'), 'Harbour')
    await user.click(await screen.findByRole('button', { name: /Job 139/ }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/jobs/139{"photoOrNote":true}'))
  })

  it('lists the engineer active jobs under the search box, newest first, with no history, no one else job, no price; the box is not auto-focused', async () => {
    const user = userEvent.setup()
    render(
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ali', role: 'engineer' } }}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/capture']}>
            <Routes>
              <Route path="/capture" element={<CaptureRoute />} />
              <Route path="/jobs/*" element={<Where />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </SessionProvider>,
    )
    const list = await screen.findByRole('list', { name: 'Your jobs' })
    const rows = within(list).getAllByRole('button')
    expect(rows.map(b => b.textContent)).toEqual(['Job 202 · Company 202Part of 202', 'Job 201 · Company 201' + '3 items · Flowmeter'])
    expect(screen.queryByText(/Company 203|Company 204/)).toBeNull()
    expect(list.textContent).not.toMatch(/PKR|Rs|PO/)
    expect(screen.getByLabelText('Find the job')).not.toHaveFocus()
    await user.click(rows[1]!)
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/jobs/201{"photoOrNote":true}'))
  })

  it('typing a search replaces the list with the matches', async () => {
    const user = userEvent.setup()
    render(
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ali', role: 'engineer' } }}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/capture']}>
            <Routes>
              <Route path="/capture" element={<CaptureRoute />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </SessionProvider>,
    )
    await screen.findByRole('list', { name: 'Your jobs' })
    await user.type(screen.getByLabelText('Find the job'), 'Harbour')
    expect(screen.queryByRole('list', { name: 'Your jobs' })).toBeNull()
    expect(await screen.findByRole('list', { name: 'Jobs found' })).toBeInTheDocument()
  })

  it('Add to job opens the job with only the id of the kept item in the address, so a reload keeps it', async () => {
    const user = userEvent.setup()
    render(
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ali', role: 'engineer' } }}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/capture?share=old']}>
            <Routes>
              <Route path="/capture" element={<CaptureRoute />} />
              <Route path="/jobs/*" element={<Where />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </SessionProvider>,
    )
    await user.click(await screen.findByRole('button', { name: 'Add to job…' }))
    expect(screen.queryByRole('list', { name: 'Your jobs' })).toBeNull() // the kept item's picker is the search box alone
    expect(screen.getByLabelText('Find the job')).toHaveFocus()
    await user.type(screen.getByLabelText('Find the job'), 'Harbour')
    await user.click(await screen.findByRole('button', { name: /Job 139/ }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/jobs/139?shared=oldnull'))
  })
})
