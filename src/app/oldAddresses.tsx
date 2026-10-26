import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { jobKeyFor, wantsOld, chipForOldList, type OldKind } from '@/app/oldAddressesModel'

/*
 * The old RFQ and Order addresses (redesign phase 5, P5-F; owner decision 9: the old pages stay reachable for two weeks).
 * RFQs and Orders are no longer destinations: one customer request is one Job.
 *   /rfqs/<id>, /orders/<id>   open the Job that holds that RFQ or order (v_jobs gives the key), the query string kept
 *   /rfqs, /orders             open the Jobs list with the matching filter (Mine, Open or History)
 *   any of them with ?old=1     the old page, exactly as it was, until the removal date in docs/DECISIONS.md and END-CHECKLIST.md.
 *                               The choice is remembered on this device (OLD_PAGES_KEY), so the old pages' own links keep working;
 *                               ?old=0 goes back to Jobs.
 * /rfqs/new is not here: New enquiry keeps its own address.
 */
function ToJob({ kind, id, search }: { kind: OldKind; id: string; search: string }) {
  const [state, setState] = useState<{ key: string | null } | 'loading' | 'failed'>('loading')
  useEffect(() => {
    let live = true
    jobKeyFor(kind, id).then(
      key => live && setState({ key }),
      () => live && setState('failed'),
    )
    return () => {
      live = false
    }
  }, [kind, id])
  if (state === 'loading') return null
  if (state === 'failed' || state.key === null) return <NotFoundPage />
  return <Navigate to={{ pathname: `/jobs/${encodeURIComponent(state.key)}`, search }} replace />
}

/** Wraps the old screen of /rfqs or /orders: the old page with ?old=1, otherwise the Jobs page for the same thing. */
export function OldAddress({ kind, children }: { kind: OldKind; children: ReactNode }) {
  const { pathname, search } = useLocation()
  if (wantsOld(search)) return <>{children}</>
  const rest = pathname.split('/').filter(Boolean).slice(1)
  if (rest.length === 0) {
    const chip = chipForOldList(search)
    return <Navigate to={{ pathname: '/jobs', search: chip ? `?chip=${chip}` : '' }} replace />
  }
  if (rest.length === 1) return <ToJob kind={kind} id={rest[0]} search={search} />
  return <NotFoundPage />
}
