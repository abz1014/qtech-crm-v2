// Ported from src/components/ErrorBoundary.tsx @ 7a29f3a (Q-Tech CRM v1). Dropped lucide icon and glass-card styling; plain markup, no telemetry.
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

// Suspense only handles "loading"; it does not catch render errors. This
// boundary shows a contained, recoverable fallback instead of a white screen.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught render error:', error, errorInfo)
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert" className="flex min-h-screen items-center justify-center p-4">
          <div className="w-full max-w-md space-y-4 text-center">
            <h1 className="text-lg font-bold">Something went wrong</h1>
            <p className="text-sm">
              An unexpected error occurred. Reloading the page usually fixes this.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full rounded-lg py-2.5 text-sm font-medium"
            >
              Reload page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
