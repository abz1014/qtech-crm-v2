import { looksLikePriceReply } from '@/features/capture/model'

/*
 * Add to this job (P4-B, plan section (h)): a pasted message, a photo or a file is added to the job it is opened on, and the app
 * GUESSES what it is, so the usual case is one tap to confirm:
 *   price    a supplier's reply with prices (matched to one of the suppliers asked)  -> "Accept N prices"
 *   answer   the customer answering a question we asked                              -> saved on the question
 *   photo    a site photo (a picture, or a picture file)                             -> attached to the job
 *   note     anything else                                                           -> appended to the job's notes
 * A one-tap change corrects the guess. An engineer can add only a photo or a note, never a price (owner decision 2026-10-22), and
 * only an enquiry (RFQ) has suppliers and customer questions. Pure rules, no React and no database.
 */
export type AddKind = 'price' | 'answer' | 'photo' | 'note'

export const KIND_LABEL: Record<AddKind, string> = {
  price: 'Supplier price',
  answer: 'Customer answer',
  photo: 'Site photo',
  note: 'Note',
}

export interface SupplierRef {
  id: string
  name: string
}

export interface AddContext {
  /** The person may see and write prices (admin, sales). */
  money: boolean
  /** The job has an enquiry (RFQ) to hold prices and questions; a direct order has none. */
  hasRfq: boolean
  /** The suppliers asked on the enquiry. */
  suppliers: readonly SupplierRef[]
  /** Questions to the customer still waiting for an answer. */
  openQuestions: number
}

export interface Added {
  text: string
  files: readonly { name: string; type: string }[]
}

const isImage = (f: { name: string; type: string }) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|heic|heif)$/i.test(f.name)

/** What this person can add here, in the order the change buttons offer them. */
export function allowedKinds(c: AddContext): AddKind[] {
  const out: AddKind[] = []
  if (c.money && c.hasRfq && c.suppliers.length > 0) out.push('price')
  if (c.money && c.hasRfq && c.openQuestions > 0) out.push('answer')
  out.push('photo', 'note')
  return out
}

/** The kind to start on. Always one of `allowedKinds`. */
export function guessKind(a: Added, c: AddContext): AddKind {
  const allowed = allowedKinds(c)
  const text = a.text.trim()
  const pick = (k: AddKind): AddKind => (allowed.includes(k) ? k : 'note')
  if (!text) return a.files.length > 0 && a.files.every(isImage) ? 'photo' : 'note'
  if (looksLikePriceReply(text)) return pick('price')
  if (allowed.includes('answer') && a.files.every(isImage)) return 'answer'
  return 'note'
}

const FILLER = new Set(['ltd', 'limited', 'pvt', 'private', 'llc', 'inc', 'co', 'company', 'corp', 'gmbh', 'trading', 'industries', 'industrial', 'solutions', 'systems', 'international', 'enterprises', 'the', 'and'])

/** The words of a supplier's name that identify it: 3 letters or more, no "Ltd" or "Trading". */
const nameWords = (name: string): string[] =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3 && !FILLER.has(w))

/**
 * Which supplier asked wrote this: the one whose name has a word in the text (the most words wins; a tie is no answer), or the
 * only one asked. Null when the text names none and several were asked: the person picks.
 */
export function matchSupplier(text: string, suppliers: readonly SupplierRef[]): SupplierRef | null {
  if (suppliers.length === 1) return suppliers[0]
  const hay = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  const scored = suppliers.map(s => ({ s, hits: nameWords(s.name).filter(w => hay.includes(` ${w} `) || hay.includes(` ${w}`)).length })).filter(x => x.hits > 0)
  if (scored.length === 0) return null
  scored.sort((a, b) => b.hits - a.hits)
  return scored.length > 1 && scored[0].hits === scored[1].hits ? null : scored[0].s
}

/** "Supplier price from Rhein Automation", "Site photo", "Note": what the guess says, in one line. */
export function guessLine(kind: AddKind, supplier: SupplierRef | null): string {
  return kind === 'price' && supplier ? `${KIND_LABEL.price} from ${supplier.name}` : KIND_LABEL[kind]
}

export const hasContent = (a: Added): boolean => a.text.trim().length > 0 || a.files.length > 0
