import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Icon } from '@/ui/Icon'

/*
 * The one card every page outside the shell sits in (Forest 84-auth-errors, .au-screen / .au-card): sign-in, the offline
 * sign-in page and the "still signed in, offline" page. Canvas behind, a white card 360 wide with the card radius and e1
 * shadow; on a phone the card is the page (no edge, no shadow). The wordmark is passed in, so each page keeps its own image.
 */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-gutter py-8 max-sm:items-start max-sm:bg-surface max-sm:px-0 max-sm:py-6">
      <div className="grid w-full max-w-[22.5rem] gap-5 rounded-card border border-line bg-surface px-5 pb-6 pt-6 shadow-e1 max-sm:max-w-none max-sm:border-0 max-sm:px-4 max-sm:shadow-none">
        {children}
      </div>
    </main>
  )
}

/** Title and one line under it (.au-head): the heavy Forest card title. */
export function AuthHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid gap-1">
      <h1 className="text-xl font-heavy tracking-snug">{title}</h1>
      {children ? <p className="text-sm text-fg-muted text-pretty">{children}</p> : null}
    </div>
  )
}

/** Icon tile beside a title (.au-lead): the warning tone, 40 square, control radius. */
export function AuthLead({ icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-control bg-tone-warning-bg text-tone-warning-fg">
        <Icon icon={icon} size="lg" />
      </span>
      <div className="grid min-w-0 gap-2">
        <h1 className="text-xl font-heavy tracking-snug">{title}</h1>
        <div className="grid gap-2 text-sm text-fg-muted text-pretty">{children}</div>
      </div>
    </div>
  )
}
