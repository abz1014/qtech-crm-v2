import { render, screen, waitFor } from '@testing-library/react'
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
vi.mock('@/features/jobs/hooks', () => ({
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
    await user.type(screen.getByLabelText('Find the job'), 'Harbour')
    await user.click(await screen.findByRole('button', { name: /Job 139/ }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/jobs/139?shared=oldnull'))
  })
})
