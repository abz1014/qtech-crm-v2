import { useEffect } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useCapture } from '@/app/capture/useCapture'

/**
 * /capture is where the Android share target lands (the service worker stores the shared item and redirects here with
 * ?share=<id>), and where a sign-in redirect returns to. It opens the Capture sheet over the person's home screen.
 */
export default function CaptureRoute() {
  const [params] = useSearchParams()
  const { openShared } = useCapture()
  const id = params.get('share')
  useEffect(() => {
    openShared(id)
  }, [id, openShared])
  return <Navigate to="/" replace />
}
