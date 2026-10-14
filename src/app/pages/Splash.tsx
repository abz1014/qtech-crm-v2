import { LoaderCircle } from 'lucide-react'
import { Icon } from '@/ui/Icon'

/** Shown while Auth and the role lookup settle, so a signed-in person never sees the sign-in page flash. */
export function Splash() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas" aria-busy="true">
      <div role="status" className="flex items-center gap-2 text-sm text-fg-muted">
        <Icon icon={LoaderCircle} className="animate-spin motion-reduce:animate-none" />
        <span>Loading</span>
      </div>
    </main>
  )
}
