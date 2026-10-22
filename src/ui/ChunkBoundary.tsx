import { Component, Fragment, type ReactNode } from 'react'

interface Props {
  /** Shown while the part cannot be downloaded (no signal yet): the same placeholder as while it loads. */
  fallback: ReactNode
  children: ReactNode
}

/**
 * Around a part of a page that is downloaded after the page (perf/lcp: the lower panels, a dialog). If its download fails
 * (the phone lost signal before it arrived), the placeholder stays instead of the page breaking, and it is tried again as soon
 * as the phone is back online. Any other error is passed on to the page's own boundary.
 */
export class ChunkBoundary extends Component<Props, { failed: boolean; other: unknown; attempt: number }> {
  state = { failed: false, other: null as unknown, attempt: 0 }

  static getDerivedStateFromError(error: unknown) {
    return isDownloadFailure(error) ? { failed: true } : { other: error }
  }

  componentDidMount() {
    window.addEventListener('online', this.retry)
  }

  componentWillUnmount() {
    window.removeEventListener('online', this.retry)
  }

  retry = () => {
    if (this.state.failed) this.setState(s => ({ failed: false, attempt: s.attempt + 1 }))
  }

  render() {
    // Not a download failure: the page's own boundary deals with it, as before.
    if (this.state.other) throw this.state.other
    return this.state.failed ? this.props.fallback : <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
  }
}

/** A lazy part that could not be downloaded: the browser's own error, or importWithReload's plain sentence when offline. */
function isDownloadFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { name, message } = error as { name?: unknown; message?: unknown }
  return name === 'StaleAppError' || (typeof message === 'string' && /dynamically imported module|Importing a module script failed|Unable to preload/i.test(message))
}
