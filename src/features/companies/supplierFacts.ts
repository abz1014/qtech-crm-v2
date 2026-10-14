import type { SupplierStats } from '@/features/companies/api'

/*
 * What the supplier panel says, decided in one pure function (DATA_MODEL section 5c display rules).
 * Rates are always shown with their counts, never a percentage; a measure only appears once there is
 * enough behind it; below the thresholds the panel states the raw fact or says what unlocks it.
 * Nothing here is a score and nothing here orders anything.
 */
export interface SupplierFacts {
  asked: number
  replied: number
  quoted: number
  declined: number
  waiting: number
  /** "Asked 6 · replied 5 of 6" once there are 3 or more enquiries; "Asked twice, 1 reply" below that. */
  enquirySummary: string
  replyTime: { kind: 'known'; days: number; logged: number; importedLeftOut: number } | { kind: 'withheld'; logged: number; importedOnly: boolean }
  chosen: { kind: 'known'; chosen: number; of: number } | { kind: 'none' }
  deliveries: { kind: 'known'; total: number; late: number; medianDaysLate: number | null } | { kind: 'none' }
  lastContact: string | null
  provenance: { legacyAsked: number; pricesHidden: number; importedOnly: boolean; hasImported: boolean }
  lowData: boolean
  empty: boolean
}

const WORDS = ['no times', 'once', 'twice']
const times = (n: number) => (n < WORDS.length ? WORDS[n] : `${n} times`)
const replies = (n: number) => (n === 1 ? '1 reply' : n === 0 ? 'no replies' : `${n} replies`)

export function supplierFacts(s: SupplierStats | null): SupplierFacts | null {
  if (!s) return null
  const asked = s.asked ?? 0
  const replied = s.replied ?? 0
  const quoted = s.quoted ?? 0
  const declined = s.no_offer ?? 0
  const legacyAsked = s.legacy_asked ?? 0
  const logged = s.reply_days_n ?? 0
  const deliveries = s.deliveries ?? 0
  const late = s.late ?? 0
  const chosenOf = s.chosen_of ?? 0

  const enquirySummary =
    asked >= 3
      ? `Asked ${asked} · replied ${replied} of ${asked}${declined >= 1 ? ` · couldn't offer ${declined} of ${asked}` : ''}`
      : `Asked ${times(asked)}${asked ? `, ${replies(replied)}` : ''}`

  return {
    asked,
    replied,
    quoted,
    declined,
    waiting: Math.max(asked - replied, 0),
    enquirySummary,
    replyTime:
      s.median_reply_days !== null && s.median_reply_days !== undefined
        ? { kind: 'known', days: Math.round(s.median_reply_days), logged, importedLeftOut: Math.max(replied - logged, 0) }
        : { kind: 'withheld', logged, importedOnly: asked > 0 && legacyAsked === asked },
    chosen: chosenOf >= 1 ? { kind: 'known', chosen: s.chosen ?? 0, of: chosenOf } : { kind: 'none' },
    deliveries:
      deliveries >= 1 ? { kind: 'known', total: deliveries, late, medianDaysLate: s.median_days_late ?? null } : { kind: 'none' },
    lastContact: s.last_contact ?? null,
    provenance: {
      legacyAsked,
      pricesHidden: s.prices_hidden ?? 0,
      importedOnly: asked > 0 && legacyAsked === asked,
      hasImported: legacyAsked > 0,
    },
    lowData: asked < 3,
    empty: asked === 0 && deliveries === 0 && s.last_contact === null,
  }
}
