import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { queryClient } from '@/lib/queryClient'
import { AppRoutes } from '@/app/routes'
import { devSessionFromUrl } from '@/app/devSession'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'

// A03 replaces this with the Supabase-backed session. Until then only dev builds
// can sign in (devSession.ts); a production build shows the sign-in page.
const session: SessionState = devSessionFromUrl() ?? { status: 'signed-out' }

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SessionProvider value={session}>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </SessionProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
