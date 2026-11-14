import type { ReactNode } from 'react'
import { CircleDot, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CARD } from '@/ui/card'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'

/*
 * The parts every Settings page shares (mockups 77-settings-lists, 78-settings-pages), so Company profile, Tax deadlines, Backups,
 * Your details and Change password read as one family: each section a Forest card (CARD) with its title and one hint line, the
 * read-only pages' facts as label-left rows, the save bar a white card that lifts and sticks to the bottom once something changed.
 */

export function SettingsSection({
  title,
  hint,
  children,
  work,
  testId,
  className,
}: {
  title: string
  hint?: ReactNode
  children: ReactNode
  /** The page's main work area (data-work, read by the e2e screen sweeps). */
  work?: boolean
  testId?: string
  className?: string
}) {
  return (
    <section className={cn(CARD, 'grid min-w-0 gap-4 p-card', className)} data-work={work ? '' : undefined} data-testid={testId}>
      <div className="grid gap-1">
        <h2 className="type-section">{title}</h2>
        {hint ? <p className="max-w-prose text-base text-fg-muted text-pretty">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

/** Label left, value right on a tablet and up; stacked on a phone. Used by the read-only Company profile and Your details. */
export const FACTS = 'grid gap-x-6 gap-y-3 text-base sm:grid-cols-[10rem_minmax(0,1fr)]'

/** "Only an admin can edit": the read-only pages say it once, beside the title. */
export function ViewOnlyTag() {
  return (
    <span className="inline-flex min-h-chip items-center gap-2 rounded-pill bg-deep px-3 text-sm font-medium text-fg-2">
      <Icon icon={Lock} size="sm" />
      Only an admin can edit
    </span>
  )
}

/**
 * The save bar under a form: "Nothing to save yet", or "2 unsaved changes: Phone, Email" with Discard and Save changes. While
 * something is unsaved it lifts (e2) and sticks to the bottom of the page, so Save is never a long scroll away.
 */
export function SaveBar({ dirty, message, children }: { dirty: boolean; message: string; children: ReactNode }) {
  return (
    <div
      data-sticky-bar=""
      data-save-bar
      className={cn(
        CARD,
        'flex flex-wrap items-center gap-3 px-card py-3 transition-shadow duration-base',
        dirty && 'sticky bottom-4 z-sticky shadow-e2',
      )}
    >
      {dirty ? <Icon icon={CircleDot} size="sm" className="text-primary" /> : null}
      <p role="status" className="min-w-0 text-base text-fg-muted">
        {message}
      </p>
      <div className="ml-auto flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

/** A loading card shaped like a section: a title line, a hint line, then `rows` field-sized bars. */
export function SectionSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className={cn(CARD, 'grid gap-4 p-card')} aria-hidden="true">
      <div className="grid gap-2">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-control w-full" />
      ))}
    </div>
  )
}
