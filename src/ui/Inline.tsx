import type { ReactNode } from 'react'
import { CircleCheck, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'

/*
 * InlineConfirm and Callout (INVENTORY: U03; D08 section 13).
 *
 * InlineConfirm: after an action that has no dialog, the place where it happened
 * says so, in success tone, with the time or the Undo: "Copied. Marked as chased
 * today, Fri 27 Nov.". `variant="line"` is the quiet one-line form that stays
 * afterwards ("Chased Fri 27 Nov").
 *
 * Callout: a dashed, quiet note about what the screen will do. It carries no
 * tone, because it is not a warning.
 */
export function InlineConfirm({
  children,
  onUndo,
  undoLabel = 'Undo',
  variant = 'box',
  className,
}: {
  children: ReactNode
  onUndo?: () => void
  undoLabel?: string
  variant?: 'box' | 'line'
  className?: string
}) {
  if (variant === 'line') {
    return (
      <span role="status" className={cn('inline-flex items-center gap-2 text-sm text-tone-success-fg', className)}>
        <Icon icon={CircleCheck} size="sm" />
        {children}
      </span>
    )
  }
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-3 rounded border border-tone-success-fg/25 bg-tone-success-bg px-4 py-3 text-sm text-fg',
        className,
      )}
    >
      <Icon icon={CircleCheck} className="text-tone-success-fg" />
      <p className="min-w-0 flex-1 text-pretty">{children}</p>
      {onUndo ? (
        <Button variant="quiet" size="sm" onClick={onUndo} className="shrink-0">
          {undoLabel}
        </Button>
      ) : null}
    </div>
  )
}

export function Callout({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start gap-3 rounded border border-dashed border-line-input px-4 py-3 text-sm text-fg-2', className)}>
      <Icon icon={Info} className="mt-[2px] text-fg-muted" />
      <p className="min-w-0 text-pretty">
        {title ? <b className="font-medium text-fg">{title} </b> : null}
        {children}
      </p>
    </div>
  )
}
