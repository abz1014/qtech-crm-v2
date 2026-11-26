import type { ComponentProps } from 'react'
import { EmptyState } from '@/ui/EmptyState'
import { CARD } from '@/ui/card'
import { cn } from '@/lib/utils'

/**
 * A shell-level state page (Forest 58 #money-checks-sales, 59 #rp-noaccess, 84-auth-errors): the one white card holding the shared
 * EmptyState, inside the shell so the navigation stays usable. Page not found and every role lock screen (NoAccessPage) draw it, so
 * they are one look and one width (screen review 27: the 404 card had its own style, and the lock cards took the width of their
 * words, since an auto-margin grid item shrinks to its content; `w-full` holds every one at the list width).
 * The title is the page's h1 for a screen reader; the EmptyState draws it.
 */
export function PageFrame({ title, className, ...state }: Omit<ComponentProps<typeof EmptyState>, 'title' | 'bordered'> & { title: string }) {
  return (
    <div className={cn('mx-auto grid w-full max-w-list content-start px-gutter pb-12 pt-6 md:pt-12', className)}>
      <h1 className="sr-only">{title}</h1>
      <div className={cn(CARD, 'p-card')}>
        <EmptyState title={title} {...state} />
      </div>
    </div>
  )
}
