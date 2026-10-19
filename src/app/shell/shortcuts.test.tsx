import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import { AppShell } from '@/app/shell/AppShell'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { Avatar } from '@/ui/Avatar'
import { installFakeDb } from '@/test/fakeSupabase'

installFakeDb(() => ({ data: [] })) // the shell reads the nav counts
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

vi.mock('@/features/capture/CaptureSheet', () => ({ default: () => <div role="dialog" aria-label="Capture" /> }))
vi.mock('@/features/search/api', () => ({ searchAll: () => Promise.resolve([]) }))

const signedIn: SessionState = { status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role: 'sales' } }

function Where() {
  const { pathname, search } = useLocation()
  return <p data-testid="where">{pathname + search}</p>
}

function BarPage() {
  useMobileBar({ title: 'Team', back: { to: '/today' }, action: <button type="button">Add</button> })
  return <p>Bar page</p>
}

function shell(path = '/today') {
  return render(
    <QueryClientProvider client={client}>
    <SessionProvider value={signedIn}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            element={
              <>
                <Where />
                <AppShell />
              </>
            }
          >
            <Route path="/today" element={<input aria-label="Notes" />} />
            <Route path="/rfqs/new" element={<p>Intake</p>} />
            <Route path="/rfqs" element={<p>RFQs page</p>} />
            <Route path="/bar" element={<BarPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </SessionProvider>
    </QueryClientProvider>,
  )
}

const press = (key: string, target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })

afterEach(() => window.localStorage.clear())

describe('palette Actions and global shortcuts (A-89)', () => {
  it('idle lists Actions: New RFQ (N), Paste or photo (C), Go to Today (G T)', async () => {
    const user = userEvent.setup()
    shell()
    await user.click(screen.getAllByRole('button', { name: /^Search or jump to/ })[0])
    const dlg = await screen.findByRole('dialog', { name: 'Search or jump to' })
    expect(await within(dlg).findByText('Actions')).toBeInTheDocument()
    const text = within(dlg).getAllByRole('option').map(r => r.textContent)
    expect(text).toEqual(expect.arrayContaining(['New RFQGo to intakeN', 'Paste or photoActionC', 'Go to TodayG T']))
  })

  it('N opens intake, C opens the capture surface, G then T goes to Today', async () => {
    shell('/rfqs')
    press('n')
    expect(await screen.findByText('Intake')).toBeInTheDocument()
    expect(screen.getByTestId('where').textContent).toBe('/rfqs/new')
    press('g')
    press('t')
    expect(screen.getByTestId('where').textContent).toBe('/today')
    press('c')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('where').textContent).toBe('/today')
  })

  it('T alone does nothing, and typing in a field never triggers a shortcut', async () => {
    shell('/today')
    press('t')
    expect(screen.getByTestId('where').textContent).toBe('/today')
    const field = screen.getByRole('textbox', { name: 'Notes' })
    press('n', field)
    expect(screen.getByTestId('where').textContent).toBe('/today')
  })
})

describe('phone bar (A-82)', () => {
  it('useMobileBar swaps in back + title + action, and the default returns on unmount', async () => {
    const user = userEvent.setup()
    shell('/bar')
    const back = await screen.findByRole('button', { name: 'Back' })
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
    await user.click(back)
    expect(screen.getByTestId('where').textContent).toBe('/today')
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Search' }).length).toBeGreaterThan(0)
  })

})

describe('Avatar sizes (A-84)', () => {
  it.each([
    ['sm', 'size-[24px]'],
    ['md', 'size-[28px]'],
    ['lg', 'size-[32px]'],
    ['xl', 'size-[36px]'],
    ['2xl', 'size-[40px]'],
  ] as const)('%s is %s', (size, cls) => {
    render(<Avatar name="Ayesha Rana" size={size} />)
    expect(screen.getByRole('img', { name: 'Ayesha Rana' }).className).toContain(cls)
  })
})
