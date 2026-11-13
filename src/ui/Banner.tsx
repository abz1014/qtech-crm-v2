import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'

/*
 * Banner (D08 section 01; Forest .qb-banner): info, warning, error (danger) and success strips with
 * an optional action. Tone is carried by glyph + colour + text, never colour alone. Forest: the tone's tint with its ink,
 * no edge, 12 px corners; the action sits at the end and drops under the words when the strip is narrow.
 */
const TONES: Record<string, { icon: LucideIcon; box: string; glyph: string; live: 'status' | 'alert' }> = {
  info: { icon: Info, box: 'bg-tone-info-bg text-tone-info-fg', glyph: 'text-tone-info-fg', live: 'status' },
  warning: { icon: TriangleAlert, box: 'bg-tone-warning-bg text-tone-warning-fg', glyph: 'text-tone-warning-fg', live: 'status' },
  danger: { icon: CircleAlert, box: 'bg-tone-danger-bg text-tone-danger-fg', glyph: 'text-tone-danger-fg', live: 'alert' },
  success: { icon: CircleCheck, box: 'bg-tone-success-bg text-tone-success-fg', glyph: 'text-tone-success-fg', live: 'status' },
}

export type BannerTone = 'info' | 'warning' | 'danger' | 'success'

interface BannerProps {
  tone?: BannerTone
  /** The one-line statement ("Rate is 14 days old"). */
  title: ReactNode
  /** What it means or what to do. Optional second line. */
  children?: ReactNode
  /** An optional action, usually a small secondary Button. */
  action?: ReactNode
  /** A Lucide glyph that replaces the tone's default (info, triangle-alert, circle-alert, circle-check). The tone still sets the colour. */
  icon?: LucideIcon
  className?: string
}

export function Banner({ tone = 'info', title, children, action, icon, className }: BannerProps) {
  const t = TONES[tone]
  return (
    <div role={t.live} className={cn('flex flex-wrap items-start gap-3 rounded-control px-4 py-3 text-sm font-medium', t.box, className)}>
      <Icon icon={icon ?? t.icon} className={cn('mt-[2px]', t.glyph)} />
      <div className="grid min-w-[12rem] flex-1 gap-[2px] text-pretty">
        <p className="font-bold">{title}</p>
        {children ? <p className="font-regular text-fg">{children}</p> : null}
      </div>
      {action ? <div className="ml-auto self-center">{action}</div> : null}
    </div>
  )
}
