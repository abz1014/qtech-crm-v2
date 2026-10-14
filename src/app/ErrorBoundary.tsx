// Ported from src/components/ErrorBoundary.tsx @ 7a29f3a (Q-Tech CRM v1). Restyled with design tokens and primitives; no telemetry.
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/ui/Button'
import { cn } from '@/lib/utils'

interface ErrorBoundaryProps {
  children: ReactNode
  /** `page` (default) fills the screen; `inline` sits inside the shell so the navigation stays usable. */
  variant?: 'page' | 'inline'
}

interface ErrorBoundaryState {
  error: Error | null
}

// Suspense only handles "loading"; it does not catch render errors. This
// boundary shows a contained, recoverable fallback instead of a white screen.
// Wording follows DESIGN_SYSTEM 13: what happened, what is safe, what to do.
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
        <div
          role="alert"
          className={cn(
            'flex items-center justify-center bg-canvas p-4',
            this.props.variant === 'inline' ? 'min-h-full py-16' : 'min-h-screen',
          )}
        >
          <div className="grid w-full max-w-sm justify-items-center gap-4 text-center">
            <h1 className="text-xl font-semibold tracking-snug">Something went wrong</h1>
            <p className="text-sm text-fg-2">
              This page stopped because of an error. Nothing you saved has changed. Reload to try again.
            </p>
            <Button variant="primary" icon={RefreshCw} onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
