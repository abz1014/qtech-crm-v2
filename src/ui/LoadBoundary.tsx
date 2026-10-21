import { Component, type ErrorInfo, type ReactNode } from 'react'

/*
 * A small error boundary for one lazily loaded part of the shell (the search palette, the Keyboard shortcuts sheet, Help,
 * Paste or photo). Without it a chunk that cannot be downloaded (no signal, before it was ever cached) reaches the root
 * ErrorBoundary and the whole app, with whatever is being typed, is replaced by "Something went wrong" (hunt HE-2).
 * Here the failure stays local: `fallback` is shown in its place (often nothing), and `onError` lets the owner offer a
 * retry. Give it a new `key` to try again (useRetryableLazy's `attempt`).
 */
interface Props {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: unknown) => void
}

export class LoadBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.warn('A part of the app could not load:', error, info.componentStack)
    this.props.onError?.(error)
  }

  render(): ReactNode {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children
  }
}
