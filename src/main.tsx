import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initInstallCapture } from '@/lib/pwa/install'
import { registerServiceWorker } from '@/lib/pwa/updates'
import './index.css'

initInstallCapture()
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
