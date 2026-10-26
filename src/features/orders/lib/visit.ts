/*
 * The visit's time and type (redesign phase 7, migration 0101; owner-question Q6 default). A visit is installation, survey or service
 * with an optional time. The database stores a Postgres `time` ("10:00:00"); a screen shows "10:00" and writes "10:00".
 */
export const VISIT_TYPES = ['installation', 'survey', 'service'] as const
export type VisitType = (typeof VISIT_TYPES)[number]

/** The long word, for a form ("Installation"). */
export const VISIT_TYPE_LABEL: Record<VisitType, string> = { installation: 'Installation', survey: 'Survey', service: 'Service' }
/** The short word for a list row ("10:00 · Install · customer · site"). */
export const VISIT_TYPE_SHORT: Record<VisitType, string> = { installation: 'Install', survey: 'Survey', service: 'Service' }

export const isVisitType = (v: string | null | undefined): v is VisitType => !!v && (VISIT_TYPES as readonly string[]).includes(v)

/** "10:00:00" or "10:00" to "10:00"; anything that is not a time is null. */
export function visitTime(v: string | null | undefined): string | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec((v ?? '').trim())
  return m ? `${m[1]}:${m[2]}` : null
}

/** "10:00 · Install · Alpenmark Controls · Site 2": the parts that are set, in that order, joined with a middle dot. */
export function visitLine(v: { time: string | null | undefined; type: string | null | undefined; customer: string; site?: string | null }): string {
  const parts = [visitTime(v.time), isVisitType(v.type) ? VISIT_TYPE_SHORT[v.type] : null, v.customer, v.site ?? null]
  return parts.filter((p): p is string => !!p).join(' · ')
}

/** A form's visit fields: "" means not set. */
export interface VisitValue {
  time: string
  type: string
}

export const visitValueOf = (o: { visitTime: string | null; visitType: string | null }): VisitValue => ({ time: o.visitTime ?? '', type: o.visitType ?? '' })

/** The patch for orders: empty means "not set" (null). A time that is not a time is left out rather than sent. */
export function visitPatch(v: VisitValue): { commissioning_time: string | null; visit_type: string | null } {
  return { commissioning_time: visitTime(v.time), visit_type: isVisitType(v.type) ? v.type : null }
}

export const visitChanged = (a: VisitValue, b: VisitValue): boolean => (visitTime(a.time) ?? '') !== (visitTime(b.time) ?? '') || a.type !== b.type
