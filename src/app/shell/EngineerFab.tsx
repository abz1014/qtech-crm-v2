import { useNavigate } from 'react-router-dom'
import { Camera, HandCoins } from 'lucide-react'
import { Icon } from '@/ui/Icon'
import { cn } from '@/lib/utils'

/*
 * The engineer's phone bar centre (redesign phase 5, P7-C): a big "Photo or note" button between To do and Jobs, and "I paid" beside it
 * (the engineer's own expense claims, /my-expenses). Navy, not green: the screen's own button (Delivered today, Installed today) is the
 * one green. Photo or note opens the job picker (/capture: "Add to job…", the only choice an engineer has there), which lands on the
 * job's page where "Add to this job" and lane L5's On site card take the photo or note.
 * 56 px tall, so a thumb in a site glove finds it; below 360 px "I paid" keeps its icon and name for screen readers only.
 */
export function EngineerFab({ className }: { className?: string }) {
  const navigate = useNavigate()
  return (
    <div data-engineer-fab data-surface="navy" className={cn('mx-1 -mt-3 flex items-stretch overflow-hidden rounded-panel bg-chrome text-chrome-fg shadow-pop', className)}>
      <button
        type="button"
        onClick={() => navigate('/capture')}
        className="flex min-h-[56px] items-center gap-2 px-4 text-base font-semibold transition-colors duration-fast hover:bg-chrome-field active:bg-chrome-field"
      >
        <Icon icon={Camera} size="lg" />
        Photo or note
      </button>
      <button
        type="button"
        onClick={() => navigate('/my-expenses')}
        aria-label="I paid"
        className="flex min-h-[56px] min-w-touch items-center justify-center gap-2 border-l border-chrome-edge px-3 text-base font-semibold transition-colors duration-fast hover:bg-chrome-field active:bg-chrome-field"
      >
        <Icon icon={HandCoins} size="lg" />
        <span className="max-[359px]:sr-only">I paid</span>
      </button>
    </div>
  )
}
