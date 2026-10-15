import { requireSupabase, unwrap } from '@/lib/supabase'
import type { RecentVisit } from '@/lib/capture/recents'
import { sortOpenQuestions, type Candidate, type OrderCandidate } from '@/features/capture/model'

/*
 * Capture reads and the one write of its own (R22). The destinations reuse the RFQ writes (answer a question, add questions,
 * attach a file in src/features/rfqs/api.ts); this file only lists the RFQs to offer and appends to an RFQ's notes.
 */
type Row = { id: string; number: number; company_id: string; owner_id: string | null }

/**
 * The RFQs Capture offers: those opened recently on this device (always), and the person's own open RFQs that have a question
 * waiting. Each comes with its open questions (unanswered, not withdrawn).
 */
export async function listCandidates(recents: readonly RecentVisit[], userId: string): Promise<Candidate[]> {
  const db = requireSupabase()
  const recentIds = recents.map(r => r.id)
  const [byRecent, mine] = await Promise.all([
    recentIds.length ? db.from('rfqs').select('id, number, company_id, owner_id').in('id', recentIds) : Promise.resolve({ data: [] as Row[], error: null }),
    db.from('rfqs').select('id, number, company_id, owner_id').eq('owner_id', userId).is('closed_on', null).order('number', { ascending: false }).limit(40),
  ])
  const rows = new Map<string, Row>()
  for (const r of [...unwrap(byRecent), ...unwrap(mine)]) rows.set(r.id, r)
  const ids = [...rows.keys()]
  if (ids.length === 0) return []
  const [companies, clars] = await Promise.all([
    db.from('companies').select('id, name, city').in('id', [...new Set([...rows.values()].map(r => r.company_id))]),
    db.from('clarifications').select('id, rfq_id, question, created_at, last_asked_at, ask_count').in('rfq_id', ids).is('answered_at', null).is('withdrawn_at', null),
  ])
  const companyRows = unwrap(companies)
  const names = new Map(companyRows.map(c => [c.id, c.name]))
  const cityOf = new Map(companyRows.map(c => [c.id, c.city]))
  const openBy = new Map<string, Candidate['open']>()
  for (const c of unwrap(clars)) {
    const list = openBy.get(c.rfq_id) ?? []
    list.push({ id: c.id, question: c.question, asked: Boolean(c.last_asked_at) || c.ask_count > 0, askedAt: c.last_asked_at, createdAt: c.created_at })
    openBy.set(c.rfq_id, list)
  }
  const visited = new Map(recents.map(r => [r.id, r.at]))
  return [...rows.values()]
    .map<Candidate>(r => ({
      id: r.id,
      number: r.number,
      companyName: names.get(r.company_id) ?? 'Unknown company',
      ownerId: r.owner_id,
      city: cityOf.get(r.company_id) ?? null,
      openedAt: visited.get(r.id) ?? null,
      open: sortOpenQuestions(openBy.get(r.id) ?? []),
    }))
    .filter(c => c.openedAt !== null || c.open.length > 0)
}

export async function getRfqNotes(rfqId: string): Promise<string | null> {
  const db = requireSupabase()
  const { data, error } = await db.from('rfqs').select('notes').eq('id', rfqId).maybeSingle()
  if (error) throw error
  return (data as { notes: string | null } | null)?.notes ?? null
}

export async function setRfqNotes(rfqId: string, notes: string | null): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('rfqs').update({ notes }).eq('id', rfqId)
  if (error) throw error
}

/** The orders opened lately on this device (R22), newest first. */
export async function listOrderCandidates(recents: readonly RecentVisit[]): Promise<OrderCandidate[]> {
  const ids = recents.map(r => r.id)
  if (ids.length === 0) return []
  const db = requireSupabase()
  const { data, error } = await db.from('orders').select('id, number, companies(name)').in('id', ids)
  if (error) throw error
  type Row = { id: string; number: number; companies: { name: string } | { name: string }[] | null }
  const visited = new Map(recents.map(r => [r.id, r.at]))
  return ((data ?? []) as unknown as Row[])
    .map(r => {
      const c = Array.isArray(r.companies) ? r.companies[0] : r.companies
      return { id: r.id, number: r.number, companyName: c?.name ?? 'Unknown company', openedAt: visited.get(r.id) ?? null }
    })
    .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0))
}

export async function getOrderNotes(orderId: string): Promise<string | null> {
  const db = requireSupabase()
  const { data, error } = await db.from('orders').select('notes').eq('id', orderId).maybeSingle()
  if (error) throw error
  return (data as { notes: string | null } | null)?.notes ?? null
}

export async function setOrderNotes(orderId: string, notes: string | null): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('orders').update({ notes }).eq('id', orderId)
  if (error) throw error
}
