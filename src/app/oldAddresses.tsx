import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { requireSupabase } from '@/lib/supabase'

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
export type OldKind = 'rfq' | 'order'

/** localStorage: "show the old RFQ and Order pages on this device" (set by ?old=1, cleared by ?old=0). Storage may be refused: then ?old=1 works per visit. */
export const OLD_PAGES_KEY = 'qtech.old-pages'

function wantsOld(search: string): boolean {
  const asked = new URLSearchParams(search).get('old')
  try {
    if (asked === '1') window.localStorage.setItem(OLD_PAGES_KEY, '1')
    else if (asked === '0') window.localStorage.removeItem(OLD_PAGES_KEY)
    else return window.localStorage.getItem(OLD_PAGES_KEY) === '1'
  } catch {
    return asked === '1'
  }
  return asked === '1'
}

/** The Jobs list chip an old list address asks for: its closed or history views are History, "mine" is Mine, the rest the default. */
export function chipForOldList(search: string): 'mine' | 'history' | null {
  const p = new URLSearchParams(search)
  const show = p.get('show') ?? (p.get('tab') === 'closed' ? 'closed' : null)
  if (show && ['closed', 'history', 'cancelled', 'settled', 'paid'].includes(show)) return 'history'
  if (p.get('owner') === 'mine') return 'mine'
  return null
}

/** The Job key for an RFQ or order id, or null when there is none (an address that never existed). */
export async function jobKeyFor(kind: OldKind, id: string): Promise<string | null> {
  const db = requireSupabase()
  let rfqId: string | null = kind === 'rfq' ? id : null
  if (kind === 'order') {
    const byOrder = await db.from('v_jobs').select('job_key').eq('order_id', id).limit(1)
    if (byOrder.error) throw byOrder.error
    if (byOrder.data?.[0]?.job_key) return byOrder.data[0].job_key
    // a cancelled order is not in the view's live-order column: its RFQ still has the job
    const order = await db.from('orders').select('rfq_id').eq('id', id).limit(1)
    if (order.error) throw order.error
    rfqId = order.data?.[0]?.rfq_id ?? null
    if (!rfqId) return null
  }
  const byRfq = await db.from('v_jobs').select('job_key').eq('rfq_id', rfqId as string).limit(1)
  if (byRfq.error) throw byRfq.error
  return byRfq.data?.[0]?.job_key ?? null
}

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
