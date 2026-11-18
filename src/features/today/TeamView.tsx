import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from '@/ui/Avatar'
import { EmptyState } from '@/ui/EmptyState'
import { cn } from '@/lib/utils'
import type { TodayData } from '@/features/today/api'
import { buildTeam, type TeamPerson } from '@/features/today/teamModel'
import type { TodayItem } from '@/features/today/types'
import type { JobRow } from '@/features/jobs/api'
import { useJobsList } from '@/features/jobs/hooks'
import { jobLabel, openJobsOf } from '@/features/jobs/lib/listModel'
import { stageModel } from '@/features/jobs/lib/stages'

/** How many of a person's open jobs the panel lists; the rest are one link away, in Jobs filtered to them. */
export const TEAM_JOBS = 3


/*
 * Team (admin only, read only): one panel per person, their own late count first. Each person works their own list; the admin sees
 * who is slipping without those tasks crowding the admin's list. Older-than-30-days work stays visible, grey, "since <date>".
 *
 * Open jobs (owner 2026-11-17): under each name, how many open jobs are theirs (owned, or put on as the engineer) and the newest few,
 * each with its customer and where it stands in the Jobs list's own words ("RFQ · suppliers not asked yet"), linked to the job. "See all"
 * opens Jobs filtered to that person (/jobs?person=), where Where it stands and Next step are the same columns as everywhere.
 */
export function TeamView({ data, today, selfId }: { data: TodayData; today: string; selfId: string }) {
  const people = useMemo(() => buildTeam(data, today, selfId), [data, today, selfId])
  const jobs = useJobsList('admin')
  if (people.length === 0) return <EmptyState mood="goal" title="No other team members yet">Add people in Settings, Team.</EmptyState>
  return (
    <div className="grid gap-card-gap md:grid-cols-2 xl:grid-cols-3" data-team>
      {people.map(p => (
        <Person key={p.id} person={p} jobs={jobs.data ? openJobsOf(jobs.data, p.id) : jobs.isError ? 'error' : null} />
      ))}
      <p className="text-base text-fg-muted md:col-span-2 xl:col-span-3">Read only. Each person works their own list. Late work is shown here to see who is behind.</p>
    </div>
  )
}

function Person({ person: p, jobs }: { person: TeamPerson; jobs: JobRow[] | 'error' | null }) {
  const summary = [
    p.late > 0 ? `${p.late} late` : 'Nothing late',
    p.needsYou - p.late > 0 ? `${p.needsYou - p.late} due today` : null,
    p.stale.length > 0 ? `${p.stale.length} older than 30 days` : null,
  ].filter(Boolean)
  return (
    <section aria-label={p.name} data-person={p.id} className="grid content-start gap-3 rounded-card border bg-surface p-card shadow-e1">
      <div className="flex items-center gap-3">
        <Avatar name={p.name} size="2xl" />
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{p.name}</h2>
          <p className={cn('text-base', p.late > 0 ? 'font-semibold text-tone-danger-fg' : 'text-fg-muted')} data-late={p.late}>
            {summary.join(' · ')}
          </p>
        </div>
      </div>
      <OpenJobs personId={p.id} jobs={jobs} />
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
      {/* a roll-up's bare count repeats its title (audit 2): left out */}
      {/^\d+$/.test(item.badge.text) ? null : <span className={cn('text-base font-semibold', tone, grey && 'font-regular')}>{item.badge.text}</span>}
    </li>
  )
}

/** A person's open jobs: the count, the newest few with where each stands, and the way to all of them. */
function OpenJobs({ personId, jobs }: { personId: string; jobs: JobRow[] | 'error' | null }) {
  const all = `/jobs?person=${encodeURIComponent(personId)}`
  return (
    <div className="grid gap-2 border-t border-line pt-3" data-open-jobs={personId}>
      <h3 className="flex items-baseline justify-between gap-3 text-base font-semibold text-fg-2">
        Open jobs
        {Array.isArray(jobs) ? <span className="num font-semibold text-fg" data-open-count={jobs.length}>{jobs.length}</span> : null}
      </h3>
      {jobs === null ? (
        <p role="status" className="text-base text-fg-muted">Loading jobs…</p>
      ) : jobs === 'error' ? (
        <p className="text-base text-fg-muted">Jobs could not be loaded. Open Jobs to see them.</p>
      ) : jobs.length === 0 ? (
        <p className="text-base text-fg-muted">No open jobs.</p>
      ) : (
        <>
          <ul className="grid gap-2">
            {jobs.slice(0, TEAM_JOBS).map(j => (
              <li key={j.key}>
                <Link
                  to={`/jobs/${encodeURIComponent(j.key)}`}
                  data-team-job={j.key}
                  className="grid min-h-touch gap-px rounded-row bg-canvas px-3 py-2 transition-colors duration-fast hover:bg-sunken focus-visible:bg-sunken"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="line-clamp-1 min-w-0 text-base font-semibold text-fg [overflow-wrap:anywhere]" title={j.companyName}>
                      {j.companyName}
                    </span>
                    <span className="num shrink-0 text-base font-heavy text-primary">{jobLabel(j.key)}</span>
                  </span>
                  <span className="min-w-0 text-base text-fg-2 [overflow-wrap:anywhere]" data-stands>
                    {stageModel({ stage: j.stage, stageDetail: j.stageDetail, kind: j.kind }).label}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link to={all} className="inline-flex min-h-touch items-center justify-self-start rounded text-base font-medium text-primary underline underline-offset-2">
            {jobs.length > TEAM_JOBS ? `See all ${jobs.length} open jobs` : 'Show in Jobs'}
          </Link>
        </>
      )}
    </div>
  )
}
