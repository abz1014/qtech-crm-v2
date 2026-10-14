import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { queryClient } from '@/lib/queryClient'
import { AppRoutes } from '@/app/routes'
import { devSessionFromUrl } from '@/app/devSession'
import { AuthProvider } from '@/app/AuthProvider'
import { SessionProvider } from '@/app/SessionProvider'

// Dev builds only: ?devRole= fakes a signed-in session. In production this is always
// undefined (devSession.ts is dead code there) and AuthProvider supplies the real session.
const devSession = devSessionFromUrl()

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {devSession ? (
          <SessionProvider value={devSession}>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </SessionProvider>
        ) : (
          <AuthProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </AuthProvider>
        )}
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
