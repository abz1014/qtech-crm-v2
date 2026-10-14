import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

/** Skeleton: a loading placeholder. Pulses opacity only (1 to 0.45 over 1.4 s); still under reduced motion. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" style={style} className={cn('skeleton block h-3 rounded bg-selected', className)} />
}
