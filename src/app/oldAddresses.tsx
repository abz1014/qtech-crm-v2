import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { queryClient } from '@/lib/queryClient'
import { Button } from '@/ui/Button'
import { jobsSearchForOldList, withoutOldSwitch, type OldKind } from '@/app/oldAddressesModel'

/*
 * The old RFQ and Order addresses (redesign phase 5, P5-F; owner decision 9). RFQs and Orders are no longer destinations: one customer
 * request is one Job. The old pages themselves were removed on 2026-10-30 (owner decision, ahead of the planned 2026-11-09), but
 * bookmarks and links in old messages keep working:
 *   /rfqs/<id>, /orders/<id>   open the Job that holds that RFQ or order (v_jobs gives the key), the query string kept
 *   /rfqs, /orders             open the Jobs list with the matching filter (Mine, Open or History)
 * The retired ?old=1 / ?old=0 switch is simply dropped from the address it came on, so an old link with it lands on Jobs too.
 * /rfqs/new is not here: New enquiry keeps its own address.
 */
function ToJob({ kind, id, search }: { kind: OldKind; id: string; search: string }) {
  const [state, setState] = useState<{ key: string | null } | 'loading' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setState('loading')
    // The Jobs code and the key lookup are downloaded together; the app's own start has usually begun the lookup already (routeChunks.ts).
    import('@/features/jobs/oldAddress').then(m => m.resolveOldAddress(queryClient, kind, id)).then(
      key => live && setState({ key }),
      () => live && setState('failed'),
    )
    return () => {
      live = false
    }
  }, [kind, id, attempt])
  if (state === 'loading') return null
  // A failed lookup (no signal, a timeout, a server error) is not a page that does not exist: say so, and let the person retry.
  if (state === 'failed')
    return (
      <main role="alert" className="mx-auto grid max-w-xl gap-4 px-4 py-8" data-testid="old-address-failed">
        <h1 className="text-2xl font-semibold tracking-tight">Could not open this page</h1>
        <p className="text-base text-fg-2">The job could not be looked up. Check your connection and try again.</p>
        <div>
          <Button size="touch" onClick={() => setAttempt(n => n + 1)} className="text-base">
            Try again
          </Button>
        </div>
      </main>
    )
  if (state.key === null) return <NotFoundPage />
  return <Navigate to={{ pathname: `/jobs/${encodeURIComponent(state.key)}`, search: withoutOldSwitch(search) }} replace />
}

/** An old /rfqs or /orders address: the Jobs page for the same thing (a list opens the Jobs list, an id opens its Job). */
export function OldAddress({ kind }: { kind: OldKind }) {
  const { pathname, search } = useLocation()
  const rest = pathname.split('/').filter(Boolean).slice(1)
  if (rest.length === 0) {
    return <Navigate to={{ pathname: '/jobs', search: jobsSearchForOldList(search) }} replace />
  }
  if (rest.length === 1) return <ToJob kind={kind} id={rest[0]} search={search} />
  return <NotFoundPage />
}
