/*
 * The seven stops of a job and where a job stands on them (redesign plan, "Stage bar": 7 stops, honest about parallel steps).
 *
 *   Enquiry -> Quotation -> Order -> Supplier order -> Delivery -> Invoice -> Payment
 *
 * The database (v_jobs.stage, migration 0099) says the earliest stop not finished as one word; this file turns that word into a
 * stop on the ruler. Parallel sub-states ("2 of 3 delivered", "advance received", "partly invoiced", "installation planned 28 Oct")
 * come from v_jobs.stage_detail, which is words only: no amount ever reaches an engineer's page through it.
 *
 *   stage             current stop              why
 *   enquiry           Enquiry (1)               suppliers not asked yet
 *   asking_suppliers  Quotation (2)             being priced
 *   prices_in         Quotation (2)             priced, quotation to send
 *   quoted            Order (3)                 quotation sent, waiting for the customer's order
 *   ordered           Supplier order (4)        an item to source or a supplier order to place
 *   supplier_ordered  Supplier order (4)        placed, goods not with us yet ... or Delivery (5) once they arrived / part delivered
 *   delivered         Invoice (6)               goods delivered (or none), not fully invoiced
 *   invoiced          Payment (7)               invoiced, not paid
 *   paid              none: all seven done      (installation, when needed, is a detail)
 *   lost / cancelled  the ruler stops           ends with the reason
 */
export const STOPS = ['Enquiry', 'Quotation', 'Order', 'Supplier order', 'Delivery', 'Invoice', 'Payment'] as const
export type StopName = (typeof STOPS)[number]

export type JobStageWord =
  | 'enquiry'
  | 'asking_suppliers'
  | 'prices_in'
  | 'quoted'
  | 'ordered'
  | 'supplier_ordered'
  | 'delivered'
  | 'invoiced'
  | 'paid'
  | 'lost'
  | 'cancelled'

const WORDS: readonly string[] = ['enquiry', 'asking_suppliers', 'prices_in', 'quoted', 'ordered', 'supplier_ordered', 'delivered', 'invoiced', 'paid', 'lost', 'cancelled']
export const isStageWord = (s: string | null | undefined): s is JobStageWord => s !== null && s !== undefined && WORDS.includes(s)

/** What the Jobs list and the job page need of a v_jobs row (nothing here is money). */
export interface JobStanding {
  stage: string | null
  stageDetail: string | null
  kind: 'enquiry' | 'direct'
}

export type StopState = 'done' | 'current' | 'future' | 'none' | 'stopped'

export interface StopView {
  name: StopName
  index: number
  state: StopState
  /** A parallel sub-state to draw under the stop ("2 of 3 delivered"). */
  note: string | null
  /** The Payment stop is half filled while an advance is in. */
  half: boolean
}

export interface StageModel {
  stops: StopView[]
  /** 1 to 7: the current stop; 7 for a paid job; null for a lost or cancelled one. */
  current: number | null
  /** "Stage 4 of 7 · Supplier order", the phone form. */
  phoneLabel: string
  /** The words for "Where it stands": the stop, then its detail. */
  label: string
  /** A lost or cancelled job ends with this ("Lost: price too high"); otherwise null. */
  ending: string | null
  /** The job is over (paid, lost or cancelled): nothing is "current". */
  finished: boolean
}

const ARRIVED = /arrived, not delivered|\d+ of \d+ delivered/

/** The stop (0 to 6) a stage word is waiting at, or 7 when every stop is done, or null when the ruler ends (lost, cancelled). */
export function currentStopIndex(stage: string | null, detail: string | null): number | null {
  switch (stage) {
    case 'enquiry':
      return 0
    case 'asking_suppliers':
    case 'prices_in':
      return 1
    case 'quoted':
      return 2
    case 'ordered':
      return 3
    case 'supplier_ordered':
      return detail && ARRIVED.test(detail) ? 4 : 3
    case 'delivered':
      return 5
    case 'invoiced':
      return 6
    case 'paid':
      return 7
    default:
      return null
  }
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** The detail split into its parts ("not invoiced yet, advance received" -> two), each a sentence fragment. */
const parts = (detail: string | null) => (detail ?? '').split(', ').map(s => s.trim()).filter(Boolean)

export function stageModel(job: JobStanding): StageModel {
  const detail = job.stageDetail
  const cur = currentStopIndex(job.stage, detail)
  const lostOrCancelled = job.stage === 'lost' || job.stage === 'cancelled'
  const advance = parts(detail).some(p => p === 'advance received' || p === 'part paid')
  const ending = job.stage === 'lost' ? `Lost: ${detail ?? 'closed'}` : job.stage === 'cancelled' ? cap(detail ?? 'order cancelled') : null
  const stops: StopView[] = STOPS.map((name, index) => {
    let state: StopState
    if (job.kind === 'direct' && index < 2) state = 'none'
    else if (lostOrCancelled) state = job.stage === 'cancelled' && index < 3 ? 'done' : index === 0 ? 'done' : 'stopped'
    else if (cur === null) state = 'future'
    else state = index < cur ? 'done' : index === cur ? 'current' : 'future'
    let note: string | null = null
    if (!lostOrCancelled) {
      const ps = parts(detail)
      if (index === cur) {
        // the current stop carries the detail that is about it, not the parallel ones drawn under other stops
        note = ps.filter(p => p !== 'advance received' && p !== 'invoiced' && !/^installation/.test(p) && p !== 'part paid').join(', ') || null
      }
      if (index === 6 && advance && cur !== 7) note = ps.includes('part paid') ? 'part paid' : 'advance received'
      if (index === 4 && ps.some(p => /^installation/.test(p))) note = ps.find(p => /^installation/.test(p)) ?? null
      if (index === 5 && cur !== 5 && ps.includes('invoiced')) note = 'invoiced'
      if (index === 7) note = null
    }
    return { name, index, state, note, half: index === 6 && advance && cur !== 7 }
  })
  const label =
    ending ?? (cur === 7 ? 'Paid' : cur === null ? 'Not started' : [STOPS[cur], detail ? parts(detail).join(', ') : null].filter(Boolean).join(' · '))
  const phoneLabel = ending ?? (cur === 7 ? 'All 7 stops done' : cur === null ? 'Not started' : `Stage ${cur + 1} of 7 · ${STOPS[cur]}`)
  return { stops, current: cur === null ? null : cur === 7 ? 7 : cur + 1, phoneLabel, label, ending, finished: cur === 7 || lostOrCancelled }
}
