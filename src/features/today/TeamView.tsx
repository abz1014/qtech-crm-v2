import { useMemo } from 'react'
import { Avatar } from '@/ui/Avatar'
import { EmptyState } from '@/ui/EmptyState'
import { cn } from '@/lib/utils'
import type { TodayData } from '@/features/today/api'
import { buildTeam, type TeamPerson } from '@/features/today/teamModel'
import type { TodayItem } from '@/features/today/types'


/*
 * Team (admin only, read only): one panel per person, their own late count first. Each person works their own list; the admin sees
 * who is slipping without those tasks crowding the admin's list. Older-than-30-days work stays visible, grey, "since <date>".
 */
export function TeamView({ data, today, selfId }: { data: TodayData; today: string; selfId: string }) {
  const people = useMemo(() => buildTeam(data, today, selfId), [data, today, selfId])
  if (people.length === 0) return <EmptyState mood="goal" title="Nobody else is on the team yet">Add people in Settings, Team.</EmptyState>
  return (
    <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3" data-team>
      {people.map(p => (
        <Person key={p.id} person={p} />
      ))}
      <p className="text-base text-fg-muted md:col-span-2 xl:col-span-3">Read only. Each person works their own list; late work shows here so you can see who is slipping.</p>
    </div>
  )
}

function Person({ person: p }: { person: TeamPerson }) {
  const summary = [
    p.late > 0 ? `${p.late} late` : 'Nothing late',
    p.needsYou - p.late > 0 ? `${p.needsYou - p.late} due today` : null,
    p.stale.length > 0 ? `${p.stale.length} older than 30 days` : null,
  ].filter(Boolean)
  return (
    <section aria-label={p.name} data-person={p.id} className="grid content-start gap-3 rounded-panel border bg-surface p-4">
      <div className="flex items-center gap-3">
        <Avatar name={p.name} size="2xl" />
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{p.name}</h2>
          <p className={cn('text-base', p.late > 0 ? 'font-semibold text-tone-danger-fg' : 'text-fg-muted')} data-late={p.late}>
            {summary.join(' · ')}
          </p>
        </div>
      </div>
      {p.rows.length > 0 ? (
        <ul className="grid gap-2">
          {p.rows.map(i => (
            <Line key={i.key} item={i} />
          ))}
        </ul>
      ) : null}
      {p.more > 0 ? <p className="text-base text-fg-muted">{p.more} more on their list</p> : null}
      {p.stale.length > 0 ? (
        <div className="grid gap-2" data-stale-of={p.id}>
          <h3 className="text-base font-semibold text-fg-2">Older than 30 days</h3>
          <ul className="grid gap-2">
            {p.stale.map(i => (
              <Line key={i.key} item={i} grey />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function Line({ item, grey = false }: { item: TodayItem; grey?: boolean }) {
  const tone = grey ? 'text-fg-muted' : item.badge.tone === 'danger' ? 'text-tone-danger-fg' : item.badge.tone === 'warning' ? 'text-tone-warning-fg' : 'text-fg-muted'
  return (
    <li data-rule={item.rule} data-stale={grey || undefined} className={cn('grid gap-px rounded-row px-3 py-2', grey ? 'bg-sunken' : 'bg-canvas')}>
      <span className={cn('min-w-0 text-base [overflow-wrap:anywhere]', grey ? 'text-fg-2' : 'font-semibold')}>{item.title}</span>
      <span className="min-w-0 text-base text-fg-muted [overflow-wrap:anywhere]">
        <span className="num">{item.ref}</span> · {item.party}
      </span>
      <span className={cn('text-base font-semibold', tone, grey && 'font-regular')}>{item.badge.text}</span>
    </li>
  )
}

