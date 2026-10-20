/*
 * The Companies list search, as one pure function (audit F1: a contact's name or number should find the company).
 * Every typed word must match the company's name, its city or country, one of its contacts' names, or (for a run of
 * 4 or more digits) one of its contacts' phone numbers. Phones are compared as digits only and without the
 * international prefix, Pakistan's 92 or the trunk 0, so "0301 5550142" finds "+92 301 555 0142" and the other way round.
 */

export interface SearchContact {
  name: string
  /** phoneKey() of the contact's phone; '' when there is none. */
  phoneKey: string
}

export interface SearchableCompany {
  name: string
  city: string | null
  country: string | null
  contacts: readonly SearchContact[]
}

export interface CompanyMatch {
  /** The contact the match came through, when a word matched only a contact ("Contact: Naveed Akhtar" under the name). */
  contact: string | null
}

/** A phone number as digits only, without "+" or "00", Pakistan's 92 or the trunk 0: "+92 301 555 0142" -> "3015550142". */
export function phoneKey(raw: string | null | undefined): string {
  if (!raw) return ''
  const international = /^\s*(\+|00)/.test(raw)
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('92') && (international || d.length >= 11)) return d.slice(2)
  if (d.startsWith('0')) return d.slice(1)
  return d
}

const digitCount = (s: string) => s.replace(/\D/g, '').length
/** A word made only of digits and the marks people put in phone numbers. */
const PHONEISH = /^[+(]?[\d()\-./]*\d[\d()\-./]*$/

function phoneHit(contacts: readonly SearchContact[], typed: string): SearchContact | undefined {
  if (digitCount(typed) < 4) return undefined
  const key = phoneKey(typed)
  if (!key) return undefined
  return contacts.find(c => c.phoneKey !== '' && c.phoneKey.includes(key))
}

/**
 * Does the company match what was typed? Null when it does not. Consecutive number words are tried together first, so a
 * number typed with spaces ("0301 555 0142") is one phone number; failing that, each word is tried on its own.
 */
export function matchCompany(row: SearchableCompany, query: string): CompanyMatch | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { contact: null }
  const own = `${row.name} ${row.city ?? ''} ${row.country ?? ''}`.toLowerCase()
  const names = row.contacts.map(c => c.name.toLowerCase())
  let via: string | null = null

  const wordMatches = (w: string): boolean => {
    if (own.includes(w)) return true
    const i = names.findIndex(n => n.includes(w))
    if (i >= 0) {
      via ??= row.contacts[i].name
      return true
    }
    const hit = phoneHit(row.contacts, w)
    if (hit) {
      via ??= hit.name
      return true
    }
    return false
  }

  for (let i = 0; i < words.length; ) {
    if (!PHONEISH.test(words[i])) {
      if (!wordMatches(words[i])) return null
      i++
      continue
    }
    let end = i
    while (end < words.length && PHONEISH.test(words[end])) end++
    const run = words.slice(i, end)
    const whole = run.length > 1 ? phoneHit(row.contacts, run.join(' ')) : undefined
    if (whole) via ??= whole.name
    else if (!run.every(wordMatches)) return null
    i = end
  }
  return { contact: via }
}
