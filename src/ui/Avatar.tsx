import { cn } from '@/lib/utils'
import { initials } from '@/lib/initials'

const SIZE = {
  sm: 'size-[28px] text-stamp',
  md: 'size-[32px] text-xs',
  lg: 'size-[36px] text-xs',
  xl: 'size-[40px] text-xs',
  '2xl': 'size-[44px] text-sm',
} as const

interface AvatarProps {
  name: string
  /** sm 28 (key-figures row; initials at 14 px, a picture of a name, not text to read: the name is the label), md 32 (top bar, lists), lg 36 (who-row), xl 40 (phone row), 2xl 44 (avatar-lg). */
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  className?: string
}

/** Initials in a dark circle. The full name is the accessible label and the hover title. */
export function Avatar({ name, size = 'md', className }: AvatarProps) {
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-round bg-tone-ink-bg font-semibold text-tone-ink-fg',
        SIZE[size],
        className,
      )}
    >
      <span aria-hidden="true">{initials(name)}</span>
    </span>
  )
}
