import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Sizes from DESIGN_SYSTEM section 10: 12 chips, 14 inline, 16 default, 20 list rows and tab bar, 24 empty/error. */
const SIZE = { chip: 12, sm: 14, md: 16, lg: 20, xl: 24 } as const
export type IconSize = keyof typeof SIZE

interface IconProps {
  icon: LucideIcon
  size?: IconSize
  className?: string
}

/**
 * The only way to draw a Lucide icon: one stroke width (1.75, 2 inside chips),
 * currentColor, decorative by default. An icon-only control must carry its own
 * aria-label; the icon never speaks for it.
 */
export function Icon({ icon: Glyph, size = 'md', className }: IconProps) {
  return (
    <Glyph
      aria-hidden="true"
      focusable="false"
      size={SIZE[size]}
      strokeWidth={size === 'chip' ? 2 : 1.75}
      className={cn('shrink-0', className)}
    />
  )
}
