import { useEffect } from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { RequireSession } from '@/app/guards'
import { SessionContext, type SessionState } from '@/app/session'
import { ConnectionContext, type Connection } from '@/lib/connection'

const signedIn: SessionState = { status: 'signed-in', user: { id: 'u1', name: 'Ayesha', role: 'sales' } }

/** Stands in for AppShell: a viewport-tall frame holding <main id="main">, counting its mounts. */
function Shell({ onMount }: { onMount: () => void }) {
  useEffect(onMount, [onMount])
  return (
    <div className="h-dvh" data-testid="frame">
      <main id="main">today</main>
    </div>
  )
}

function tree(session: SessionState, connection: Connection, onMount: () => void) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <SessionContext.Provider value={session}>
        <ConnectionContext.Provider value={connection}>
          <MemoryRouter initialEntries={['/today']}>
            <Routes>
              <Route path="/login" element={<p>sign-in form</p>} />
              <Route element={<RequireSession />}>
                <Route path="/today" element={<Shell onMount={onMount} />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ConnectionContext.Provider>
      </SessionContext.Provider>
    </QueryClientProvider>
  )
}

describe('RequireSession offline (phone audit 2c)', () => {
  it('online: the shell as before, no banner', () => {
    render(tree(signedIn, 'online', () => {}))
    expect(screen.getByText('today')).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('offline with a remembered person: the shell under the offline banner, not the sign-in form', () => {
    render(tree(signedIn, 'offline', () => {}))
    expect(screen.getByRole('status')).toHaveTextContent('You’re offline — Showing what’s saved; changes need signal.')
    expect(screen.getByText('today')).toBeInTheDocument()
    expect(screen.queryByText('sign-in form')).toBeNull()
  })

  it('the banner coming and going never re-mounts the shell (an open sheet stays open)', () => {
    const onMount = vi.fn()
    const { rerender } = render(tree(signedIn, 'online', onMount))
    rerender(tree(signedIn, 'offline', onMount))
    rerender(tree(signedIn, 'reconnecting', onMount))
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting')
    rerender(tree(signedIn, 'online', onMount))
    expect(onMount).toHaveBeenCalledTimes(1)
  })

  it('still signed in but nobody remembered yet: a waiting page, not an endless splash', () => {
    render(tree({ status: 'loading' }, 'offline', () => {}))
    expect(screen.getByRole('heading', { name: 'You’re offline' })).toBeInTheDocument()
    expect(screen.getByText(/You’re still signed in/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('online and loading: the splash, as before', () => {
    render(tree({ status: 'loading' }, 'online', () => {}))
    expect(screen.getByText('Loading')).toBeInTheDocument()
  })

  it('signed out goes to the sign-in route', () => {
    render(tree({ status: 'signed-out' }, 'offline', () => {}))
    expect(screen.getByText('sign-in form')).toBeInTheDocument()
  })
})
