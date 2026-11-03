import '@/lib/zodConfig'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initInstallCapture } from '@/lib/pwa/install'
import { startMinVersionChecks } from '@/lib/pwa/minVersion'
import { registerServiceWorker } from '@/lib/pwa/updates'
import { applyStoredTextSize } from '@/ui/useTextSize'
import { preloadRoute } from '@/app/routeChunks'
import { storedSessionUserId } from '@/lib/storedSession'
import { startAfterContent, whenContentDrawn } from '@/lib/afterContent'
import './index.css'

// First, before anything is drawn: the person's text size (Normal or Smaller) on <html>, so there is no jump.
applyStoredTextSize()
// The page this address opens, and its first data, start downloading now, alongside the session lookup, not after it (perf/lcp).
startAfterContent(preloadRoute(window.location.pathname, storedSessionUserId()))
initInstallCapture()
// The worker's install downloads the whole app shell (about 2 MB). It registers once the page has loaded and its content is drawn,
// so on a slow connection it does not compete with the page's own code and data (perf/lcp, src/lib/afterContent.ts).
// The minimum-version check (a small /version.json read) waits for the content too; nothing can be saved before it is drawn.
whenContentDrawn(() => {
  if (document.readyState === 'complete') void registerServiceWorker()
  else window.addEventListener('load', () => void registerServiceWorker(), { once: true })
  startMinVersionChecks()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
