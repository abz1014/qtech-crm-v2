import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'

/*
 * Banner (D08 section 01): info, warning, error (danger) and success strips with
 * an optional action. Tone is carried by glyph + colour + text, never colour alone.
 */
const TONES: Record<string, { icon: LucideIcon; box: string; glyph: string; live: 'status' | 'alert' }> = {
  info: { icon: Info, box: 'border-tone-info-fg/25 bg-tone-info-bg', glyph: 'text-tone-info-fg', live: 'status' },
  warning: { icon: TriangleAlert, box: 'border-tone-warning-fg/25 bg-tone-warning-bg', glyph: 'text-tone-warning-fg', live: 'status' },
  danger: { icon: CircleAlert, box: 'border-tone-danger-fg/25 bg-tone-danger-bg', glyph: 'text-tone-danger-fg', live: 'alert' },
  success: { icon: CircleCheck, box: 'border-tone-success-fg/25 bg-tone-success-bg', glyph: 'text-tone-success-fg', live: 'status' },
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
  /** A glyph that says more than the tone's own (wifi-off, clock). */
  icon?: LucideIcon
  className?: string
}

export function Banner({ tone = 'info', title, children, action, icon, className }: BannerProps) {
  const t = TONES[tone]
  return (
    <div role={t.live} className={cn('flex items-start gap-3 rounded border px-4 py-3 text-sm', t.box, className)}>
      <Icon icon={icon ?? t.icon} className={cn('mt-[2px]', t.glyph)} />
      <div className="grid min-w-0 flex-1 gap-[2px] text-pretty">
        <p className="font-semibold">{title}</p>
        {children ? <p className="text-fg-2">{children}</p> : null}
      </div>
      {action ? <div className="ml-auto self-center">{action}</div> : null}
    </div>
  )
}
