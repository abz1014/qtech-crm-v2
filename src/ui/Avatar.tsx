import { cn } from '@/lib/utils'
import { initials } from '@/lib/initials'

interface AvatarProps {
  name: string
  /** md is 28 (top bar, lists); sm is 22 (inside a key-figures row). */
  size?: 'md' | 'sm'
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
        'inline-grid shrink-0 place-items-center rounded-round bg-tone-ink-bg text-xs font-medium tracking-[0.02em] text-tone-ink-fg',
        size === 'md' ? 'size-[28px]' : 'size-[22px]',
        className,
      )}
    >
      <span aria-hidden="true">{initials(name)}</span>
    </span>
  )
}
