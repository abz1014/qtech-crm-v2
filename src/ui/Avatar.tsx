import { cn } from '@/lib/utils'
import { initials } from '@/lib/initials'

const SIZE = {
  sm: 'size-[24px] text-xs',
  md: 'size-[28px] text-xs',
  lg: 'size-[32px] text-xs',
  xl: 'size-[36px] text-xs',
  '2xl': 'size-[40px] text-sm',
} as const

interface AvatarProps {
  name: string
  /** sm 24 (key-figures row), md 28 (top bar, lists), lg 32 (who-row), xl 36 (phone row), 2xl 40 (avatar-lg, text-sm). */
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
        'inline-grid shrink-0 place-items-center rounded-round bg-tone-ink-bg font-medium tracking-[0.02em] text-tone-ink-fg',
        SIZE[size],
        className,
      )}
    >
      <span aria-hidden="true">{initials(name)}</span>
    </span>
  )
}
