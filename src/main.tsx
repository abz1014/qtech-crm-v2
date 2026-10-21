import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initInstallCapture } from '@/lib/pwa/install'
import { startMinVersionChecks } from '@/lib/pwa/minVersion'
import { registerServiceWorker } from '@/lib/pwa/updates'
import { applyStoredTextSize } from '@/ui/useTextSize'
import './index.css'

// First, before anything is drawn: the person's text size (Normal or Smaller) on <html>, so there is no jump.
applyStoredTextSize()
initInstallCapture()
void registerServiceWorker()
startMinVersionChecks()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
