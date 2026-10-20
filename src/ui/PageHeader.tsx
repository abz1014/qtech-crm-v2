import { Children, Fragment, isValidElement, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/*
 * PageHeader (round-2 spec 5.2): the head of a list page. One h1, one sentence of lede, and at most ONE primary (green) action
 * plus ONE secondary. Nothing else goes here: switches, search and Filters belong to the table's toolbar.
 *
 *   <div class="mx-auto grid w-full max-w-table grid-cols-[minmax(0,1fr)] content-start gap-4 px-4 pb-12 pt-6 md:px-8">
 *     <PageHeader title="Orders" lede="4 need you · 7 waiting" primary={<Button variant="primary">New order</Button>} />
 *     [Tabs or one switch row]
 *     <DataTable toolbar={[search, ≤1 switch, Filters]} … />
 *
 * The h1 is `max-md:sr-only`: on a phone the one bar already names the page, so it is not repeated (screen readers keep it).
 * In development and tests it throws when given two primaries or two secondaries, or a green button as the secondary.
 */
export interface PageHeaderProps {
  title: string
  /** One sentence, `text-sm text-fg-muted` ("4 need you · 7 waiting"). */
  lede?: ReactNode
  /** The page's one green button. */
  primary?: ReactNode
  /** At most one secondary button or link ("Reports"). */
  secondary?: ReactNode
  className?: string
}

/** How many things a slot holds, looking through fragments. */
function count(node: ReactNode): number {
  return Children.toArray(node).reduce<number>(
    (n, c) => n + (isValidElement<{ children?: ReactNode }>(c) && c.type === Fragment ? count(c.props.children) : 1),
    0,
  )
}

function isPrimary(node: ReactNode): boolean {
  return Children.toArray(node).some(c =>
    isValidElement<{ variant?: string; children?: ReactNode }>(c)
      ? c.props.variant === 'primary' || (c.type === Fragment && isPrimary(c.props.children))
      : false,
  )
}

export function PageHeader({ title, lede, primary, secondary, className }: PageHeaderProps) {
  if (import.meta.env.DEV) {
    if (count(primary) > 1) throw new Error(`PageHeader "${title}": at most one primary action (got ${count(primary)}).`)
    if (count(secondary) > 1) throw new Error(`PageHeader "${title}": at most one secondary action (got ${count(secondary)}).`)
    if (isPrimary(secondary)) throw new Error(`PageHeader "${title}": the secondary action must not be a primary (green) button.`)
  }
  const hasActions = primary != null || secondary != null
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-3', className)}>
      <div className="grid min-w-0 gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-pretty max-md:sr-only">{title}</h1>
        {lede ? <p className="text-sm text-fg-muted text-pretty">{lede}</p> : null}
      </div>
      {hasActions ? (
        <div className="flex flex-wrap items-center gap-2">
          {secondary}
          {primary}
        </div>
      ) : null}
    </header>
  )
}
