import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ARCHIVE_ENTITIES, type ArchiveEntity, type ArchiveRow } from '@/features/settings/archive/api'
import { useArchiveList, useRehide, useUnhide } from '@/features/settings/archive/hooks'
import { entityLabel, recordHref } from '@/features/settings/archive/model'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { CARD } from '@/ui/card'
import { controlClass } from '@/ui/form/fieldContext'
import { Money } from '@/ui/Money'
import { Tag } from '@/ui/Tag'
import { useToast } from '@/ui/useToast'

const PAGE = 50

/*
 * Browse the archived records of one kind. Reads ?company=<id> (another screen links here for one company's records). Each row
 * opens the record's normal page where there is one, and has Unarchive (archive_unhide); a record that was brought back shows
 * "Shown" and Put back in Archive (archive_rehide).
 */
export function BrowseSection() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const companyId = params.get('company')
  const [entity, setEntity] = useState<ArchiveEntity>('rfq')
  const [typed, setTyped] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(typed)
      setOffset(0)
    }, 300)
    return () => clearTimeout(t)
  }, [typed])

  const q = useArchiveList({ entity, companyId, search, limit: PAGE, offset })
  const unhide = useUnhide()
  const rehide = useRehide()
  const rows = q.data ?? []
  const busyId = unhide.isPending ? unhide.variables?.id : rehide.isPending ? rehide.variables?.id : null
  const companyName = companyId ? (rows.find(r => r.companyId === companyId)?.companyName ?? null) : null

  const act = async (r: ArchiveRow, back: boolean) => {
    try {
      await (back ? rehide : unhide).mutateAsync({ entity: r.entity, id: r.id })
      toast.toast({ title: back ? 'Put back in Archive' : 'Unarchived', body: r.ref ?? undefined, tone: 'success' })
    } catch (e) {
      toast.toast({ title: back ? 'Could not put it back' : 'Could not unarchive', body: mapPgError(e, { entity: 'archive' }).message, tone: 'danger' })
    }
  }
  const clearCompany = () => {
    const next = new URLSearchParams(params)
    next.delete('company')
    setParams(next, { replace: true })
    setOffset(0)
  }

  return (
    <section className={cn(CARD, 'grid gap-3 p-card')} aria-label="Browse the archive" data-testid="archive-browse">
      <h2 className="text-lg font-card">Browse archived records</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm font-medium">
          Kind
          <select
            className={cn(controlClass, 'w-auto')}
            value={entity}
            onChange={e => {
              setEntity(e.target.value as ArchiveEntity)
              setOffset(0)
            }}
          >
            {ARCHIVE_ENTITIES.map(k => (
              <option key={k} value={k}>
                {entityLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-[12rem] flex-1 gap-1 text-sm font-medium">
          Search
          <input type="search" className={controlClass} value={typed} placeholder="Number or company" onChange={e => setTyped(e.target.value)} />
        </label>
        {companyId ? (
          <div className="flex items-center gap-2 pb-1 text-base" data-testid="archive-company-filter">
            <Tag>{companyName ?? 'One company'}</Tag>
            <Button variant="quiet" size="sm" onClick={clearCompany}>
              Show all companies
            </Button>
          </div>
        ) : null}
      </div>
      {q.isError ? (
        <p role="alert" className="text-base font-medium text-tone-danger-fg">
          Could not read the archive. Try again in a moment.
        </p>
      ) : q.isPending ? (
        <p className="text-base text-fg-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-base text-fg-muted" data-testid="archive-empty">
          {offset > 0 ? 'No more records.' : `No archived ${entityLabel(entity).toLowerCase()} here.`}
        </p>
      ) : (
        <ul className="divide-y" data-testid="archive-rows">
          {rows.map(r => {
            const href = recordHref(r.entity, r.id)
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3" data-testid={`archive-row-${r.id}`}>
                <div className="grid min-w-0 flex-1 gap-1">
                  <span className="flex flex-wrap items-center gap-2 font-card">
                    {href ? (
                      <Link to={href} className="num underline-offset-2 hover:underline">
                        {r.ref ?? 'No number'}
                      </Link>
                    ) : (
                      <span className="num">{r.ref ?? 'No number'}</span>
                    )}
                    {r.isUnhidden ? <Tag>Shown</Tag> : null}
                    {r.isImported ? <Tag dashed>Imported</Tag> : null}
                  </span>
                  <span className="text-sm text-fg-muted">
                    {[r.companyName, r.docDate ? formatDay(r.docDate) : null].filter(Boolean).join(' · ') || 'No company or date'}
                  </span>
                </div>
                {r.amount !== null ? <Money value={r.amount} /> : null}
                {r.isUnhidden ? (
                  <Button variant="secondary" busy={busyId === r.id} busyLabel="Saving" onClick={() => void act(r, true)}>
                    Put back in Archive
                  </Button>
                ) : (
                  <Button variant="secondary" busy={busyId === r.id} busyLabel="Saving" onClick={() => void act(r, false)}>
                    Unarchive
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex items-center justify-between">
        <Button variant="quiet" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE))}>
          Previous
        </Button>
        <span className="text-sm text-fg-muted">{rows.length > 0 ? `Showing ${offset + 1} to ${offset + rows.length}` : ''}</span>
        <Button variant="quiet" disabled={rows.length < PAGE} onClick={() => setOffset(o => o + PAGE)}>
          Next
        </Button>
      </div>
    </section>
  )
}
