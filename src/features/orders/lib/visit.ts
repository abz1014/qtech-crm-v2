/*
 * The visit's type (redesign phase 7, migrations 0101 and 0109; owner answer to Q6, 2026-10-28). A visit is an installation, a survey or
 * a service, on a DATE. It has no time of day: the old time column is retired and nothing reads or writes it.
 */
export const VISIT_TYPES = ['installation', 'survey', 'service'] as const
export type VisitType = (typeof VISIT_TYPES)[number]

/** What a commissioning visit is unless somebody says survey or service (the database files the same default, 0109). */
export const DEFAULT_VISIT_TYPE: VisitType = 'installation'

/** The long word, for a form ("Installation"). */
export const VISIT_TYPE_LABEL: Record<VisitType, string> = { installation: 'Installation', survey: 'Survey', service: 'Service' }
/** The short word for a list row ("Install · customer · site"). */
export const VISIT_TYPE_SHORT: Record<VisitType, string> = { installation: 'Install', survey: 'Survey', service: 'Service' }

export const isVisitType = (v: string | null | undefined): v is VisitType => !!v && (VISIT_TYPES as readonly string[]).includes(v)

/** "Installation", or "" when the type is not set. */
export const visitTypeLabel = (v: string | null | undefined): string => (isVisitType(v) ? VISIT_TYPE_LABEL[v] : '')

/** "Install · Alpenmark Controls · Site 2": the parts that are set, in that order, joined with a middle dot. */
export function visitLine(v: { type: string | null | undefined; customer: string; site?: string | null }): string {
  const parts = [isVisitType(v.type) ? VISIT_TYPE_SHORT[v.type] : null, v.customer, v.site ?? null]
  return parts.filter((p): p is string => !!p).join(' · ')
}

/** A form's visit field: "" means not set. */
export interface VisitValue {
  type: string
}

export const visitValueOf = (o: { visitType: string | null }): VisitValue => ({ type: o.visitType ?? '' })

/** The patch for orders: empty means "not set" (null). */
export function visitPatch(v: VisitValue): { visit_type: string | null } {
  return { visit_type: isVisitType(v.type) ? v.type : null }
}

export const visitChanged = (a: VisitValue, b: VisitValue): boolean => a.type !== b.type
