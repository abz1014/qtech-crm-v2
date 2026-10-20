/*
 * "Open in WhatsApp" / "Open in email" links (owner decision 2026-10-20, item 1, DECISIONS.md). A link opens WhatsApp or
 * the mail app with the message already filled in; the person presses Send there. The CRM sends nothing and stores no
 * message content. Copy stays as the fallback.
 *
 *   whatsappNumber('Office 042-35761234, cell 0300-1234567')  // { ok: true, number: '923001234567', display: '0300 1234567' }
 *   waLink('0300 1234567', text)                               // { url: 'https://wa.me/923001234567?text=...', filled: true }
 *   mailtoLink({ to: 'a@x.pk', subject, body })                // { url: 'mailto:a@x.pk?subject=...&body=...', filled: true }
 *
 * Where a wa.me link goes, on each platform (decided 2026-10-20; the address is the same everywhere):
 *   Android, iPhone   the WhatsApp app opens on the chat (wa.me is WhatsApp's own app link).
 *   Desktop           a new tab shows WhatsApp's page, which hands over to WhatsApp Desktop when it is installed and
 *                     otherwise offers WhatsApp Web. Linking straight to web.whatsapp.com was rejected: it would skip
 *                     the desktop app for the people who use it, and it only works in a browser already linked to a phone.
 * A message too long for a link (LINK_LIMIT) is never cut: the link opens the empty chat or email (`filled: false`) and
 * the caller copies the message first so the person pastes it. Nothing is ever sent from here.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Phone numbers

/** mobile and landline are Pakistani numbers; international is any other country (we cannot tell its mobiles apart). */
export type PhoneKind = 'mobile' | 'landline' | 'international'

export interface PhoneNumber {
  kind: PhoneKind
  /** Country code and number, digits only, no + or 00: what wa.me takes ("923001234567"). */
  digits: string
  /** As people here write it: "0300 1234567" for a Pakistani mobile, "04235761234" for a landline, "+971501234567" abroad. */
  display: string
  /** "WhatsApp" (or "WA") is written next to this number: "WhatsApp: 0321...", "0321... (WhatsApp)". */
  labelledWhatsApp: boolean
}

type Parsed = Omit<PhoneNumber, 'labelledWhatsApp'>

// Character classes built from code points, so no invisible character is ever written into this file.
const ch = (code: number): string => String.fromCharCode(code)
const span = (from: number, to: number): string => `${ch(from)}-${ch(to)}`
const DIGIT_BLOCKS = [0x0660, 0x06f0, 0x0966, 0xff10] // Arabic-Indic, Urdu/Persian, Devanagari, fullwidth: each 0 to 9
const OTHER_DIGITS = new RegExp(`[${DIGIT_BLOCKS.map(b => span(b, b + 9)).join('')}]`, 'g')
const INVISIBLE = new RegExp(`[${span(0x200b, 0x200f)}${span(0x202a, 0x202e)}${span(0x2060, 0x2069)}${ch(0xfeff)}]`, 'g')
const DASHES = new RegExp(`[${span(0x2010, 0x2015)}${ch(0x2212)}${ch(0xfe58)}${ch(0xfe63)}${ch(0xff0d)}]`, 'g')
const SPACES = new RegExp(`[${ch(0x00a0)}${span(0x2000, 0x200a)}${ch(0x202f)}${ch(0x3000)}]`, 'g')
const WIDE_PLUS = new RegExp(ch(0xff0b), 'g')

/** Arabic-Indic, Urdu (Extended Arabic-Indic), Devanagari and fullwidth digits become 0-9. */
export function toAsciiDigits(s: string): string {
  return s.replace(OTHER_DIGITS, d => {
    const c = d.charCodeAt(0)
    const block = DIGIT_BLOCKS.find(b => c >= b && c <= b + 9) ?? c
    return String(c - block)
  })
}

/** Digits in ASCII; invisible direction marks (a WhatsApp copy carries them) gone; every dash, space and plus plain. */
function tidy(raw: string): string {
  return toAsciiDigits(raw).replace(INVISIBLE, '').replace(DASHES, '-').replace(SPACES, ' ').replace(WIDE_PLUS, '+').replace(/\+\s+/g, '+')
}

const digitsOf = (s: string): string => s.replace(/\D/g, '')

/** A Pakistani number without its 0 or +92: 3 and 9 digits is a mobile; 8 to 11 digits on any other first digit is a landline (11 for 0xx-111-xxx-xxx). */
function pakistani(nsn: string): Parsed | null {
  if (/^3\d{9}$/.test(nsn)) return { kind: 'mobile', digits: `92${nsn}`, display: `0${nsn.slice(0, 3)} ${nsn.slice(3)}` }
  if (/^[124-9]\d{7,10}$/.test(nsn)) return { kind: 'landline', digits: `92${nsn}`, display: `0${nsn}` }
  return null
}

/** One candidate, digits with an optional leading +. Null when it is not (yet) a whole number. */
function classify(candidate: string): Parsed | null {
  const d = digitsOf(candidate)
  if (candidate.startsWith('+') || d.startsWith('00')) {
    const rest = candidate.startsWith('+') ? d : d.slice(2)
    if (rest.startsWith('92')) {
      const nsn = rest.slice(2)
      return pakistani(nsn.startsWith('0') ? nsn.slice(1) : nsn) // +92 (0) 300... and +92 0300...
    }
    // Any other country: E.164 is at most 15 digits; 8 is the shortest worth opening. No country code starts with 0.
    return /^[1-9]\d{7,14}$/.test(rest) ? { kind: 'international', digits: rest, display: `+${rest}` } : null
  }
  if (d.startsWith('92') && (d.length === 12 || (d.length === 13 && d[2] === '0'))) return pakistani(d.slice(-10)) // 92 300 1234567
  if (d.startsWith('0')) return pakistani(d.slice(1))
  if (d.length === 10 && d.startsWith('3')) return pakistani(d) // 300 1234567, the 0 dropped (a spreadsheet number)
  return null
}

interface Run {
  text: string
  start: number
  end: number
  /** Runs in one chunk are separated only by spaces, dashes, dots and brackets; letters, / , ; : & and new lines end a chunk. */
  chunk: number
}

/** The number that starts at runs[i], and the index after its last run. */
function numberAt(runs: Run[], i: number): { n: Parsed; next: number } | null {
  const first = runs[i].text
  const joins = (j: number) => j < runs.length && runs[j].chunk === runs[i].chunk && !runs[j].text.startsWith('+')
  const abroad = first.startsWith('+') ? !first.startsWith('+92') : first.startsWith('00') && !first.startsWith('0092')
  if (abroad) {
    // A number abroad takes the groups after it, up to 15 digits. Its grouping says nothing we can check.
    const max = first.startsWith('+') ? 15 : 17
    let acc = first
    let j = i + 1
    while (joins(j) && digitsOf(acc).length + runs[j].text.length <= max) acc += runs[j++].text
    const n = classify(acc)
    return n ? { n, next: j } : null
  }
  // At home, the shortest set of groups that makes a whole number: "0300 1234567 0321 7654321" stays two numbers.
  let acc = ''
  for (let j = i; j === i || joins(j); j++) {
    acc += runs[j].text
    if (digitsOf(acc).length > 15) return null
    const n = classify(acc)
    if (!n) continue
    if (n.kind !== 'landline') return { n, next: j + 1 }
    // A landline takes its longest form: 021 111 222 333 is one UAN number, not 021 111 222 and a stray 333.
    let best = { n, next: j + 1 }
    let more = acc
    for (let k = j + 1; joins(k) && digitsOf(more + runs[k].text).length <= 13; k++) {
      more += runs[k].text
      const m = classify(more)
      if (m?.kind === 'landline') best = { n: m, next: k + 1 }
    }
    return best
  }
  return null
}

const WHATSAPP_LABEL = /whats\s*app|\bwhatsap\b|\bwa\b|\bwtsp\b/i

/** Where the first and last separator (, / ; & | or a new line) are in some text between numbers; -1 when there is none. */
function separators(text: string): { first: number; last: number } {
  let first = -1
  let last = -1
  for (let i = 0; i < text.length; i++) {
    if (',/;|&\n'.includes(text[i])) {
      if (first < 0) first = i
      last = i
    }
  }
  return { first, last }
}

/**
 * The words between two numbers belong to the one before (its tail) or the one after (its head): split at the
 * separators when there are any; else after a closing bracket ("0300... (WhatsApp) 0321..."); else they lead into the
 * next number ("Cell 0300... WhatsApp 0321...").
 */
function splitGap(gap: string): [tail: string, head: string] {
  const { first, last } = separators(gap)
  if (first >= 0) return [gap.slice(0, first), gap.slice(last + 1)]
  const close = gap.lastIndexOf(')')
  return close >= 0 ? [gap.slice(0, close + 1), gap.slice(close + 1)] : ['', gap]
}

/**
 * Every phone number in a contact's phone field, in the order written. Copes with what people type and paste:
 * 0300-1234567, 0300 123 4567, (0300) 1234567, 3001234567, +92 300 1234567, +92 (0) 300..., +92 0300..., 0092 300...,
 * 92 300 1234567, Urdu or Arabic-Indic digits, direction marks from a WhatsApp copy, several numbers in one field
 * ("0300-1234567 / 0321-7654321", "Off: 042 35761234 Cell: 0333 1234567", one per line) and numbers abroad (+971 50...).
 */
export function parsePhones(raw: string | null | undefined): PhoneNumber[] {
  if (!raw) return []
  const t = tidy(raw)
  const runs: Run[] = []
  let chunk = 0
  for (const m of t.matchAll(/[0-9+\-.() \t]+/g)) {
    for (const r of m[0].matchAll(/\+?\d+/g)) {
      const start = (m.index ?? 0) + (r.index ?? 0)
      runs.push({ text: r[0], start, end: start + r[0].length, chunk })
    }
    chunk += 1
  }
  const hits: { n: Parsed; first: number; next: number }[] = []
  for (let i = 0; i < runs.length; ) {
    const hit = numberAt(runs, i)
    if (hit) {
      hits.push({ n: hit.n, first: i, next: hit.next })
      i = hit.next
    } else i += 1
  }
  // Extra digits straight after a number ("0300 1234567 8901") mean a typo, not a second number: that one is not
  // trusted. A list number ("1. 0300... 2. 0321...") or the start of a broken next number (0..., +...) is not extra.
  const starts = new Set(hits.map(h => h.first))
  const found = hits
    .filter(h => {
      const after = runs[h.next]
      return !after || after.chunk !== runs[h.next - 1].chunk || starts.has(h.next) || /^[0+]/.test(after.text) || after.text.length < 2
    })
    .map(h => ({ n: h.n, start: runs[h.first].start, end: runs[h.next - 1].end }))
  return found.map((f, k) => {
    const lead = t.slice(k === 0 ? 0 : found[k - 1].end, f.start)
    const trail = t.slice(f.end, k === found.length - 1 ? t.length : found[k + 1].start)
    // Before the first number, what follows the last separator is its head; after the last, what comes before the first is its tail.
    const head = k === 0 ? lead.slice(separators(lead).last + 1) : splitGap(lead)[1]
    const end = separators(trail).first
    const tail = k === found.length - 1 ? trail.slice(0, end < 0 ? undefined : end) : splitGap(trail)[0]
    return { ...f.n, labelledWhatsApp: WHATSAPP_LABEL.test(head) || WHATSAPP_LABEL.test(tail) }
  })
}

/** Why there is no WhatsApp number: nothing saved, only a landline, or something we cannot read as a mobile. */
export type NoWhatsAppReason = 'none' | 'landline' | 'unreadable'

export type WhatsAppNumber = { ok: true; number: string; display: string } | { ok: false; reason: NoWhatsAppReason }

/**
 * The number to open WhatsApp on: the one written next to "WhatsApp", else the first Pakistani mobile, else the first
 * number abroad (it may be a landline: WhatsApp then says so, and Copy still works). Pakistani landlines are never used.
 */
export function whatsappNumber(raw: string | null | undefined): WhatsAppNumber {
  if (!raw || !/\d/.test(tidy(raw))) return { ok: false, reason: 'none' } // blank, "N/A", "-", "same as above"
  const all = parsePhones(raw)
  const pick = all.find(n => n.labelledWhatsApp && n.kind !== 'landline') ?? all.find(n => n.kind === 'mobile') ?? all.find(n => n.kind === 'international')
  if (pick) return { ok: true, number: pick.digits, display: pick.display }
  return { ok: false, reason: all.some(n => n.kind === 'landline') ? 'landline' : 'unreadable' }
}

// ---------------------------------------------------------------------------------------------------------------------
// Email addresses

const EMAIL = /[A-Z0-9._%+'-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi

/** Every address in one field or several ("a@x.pk; b@y.pk", "Ali <ali@x.pk>", "mailto:a@x.pk"), each once, in order. */
export function parseEmails(raw: string | readonly (string | null | undefined)[] | null | undefined): string[] {
  const list: readonly (string | null | undefined)[] = typeof raw === 'string' || raw == null ? [raw] : raw
  const seen = new Set<string>()
  const out: string[] = []
  for (const field of list) {
    for (const m of (field ?? '').match(EMAIL) ?? []) {
      const key = m.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        out.push(m)
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// Platform and length

export type Platform = 'android' | 'ios' | 'desktop'

/** From the browser: Android, iPhone/iPad (iPadOS says "Macintosh" but has touch points) or anything else. */
export function detectPlatform(
  nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): Platform {
  const ua = nav?.userAgent ?? ''
  if (/Android/i.test(ua)) return 'android'
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (nav?.maxTouchPoints ?? 0) > 1)) return 'ios'
  return 'desktop'
}

/**
 * The longest link we open, in characters of the whole URL. Desktop 2000: Chrome on Windows will not hand a URL longer
 * than 2048 characters to another program (mailto: to Outlook, whatsapp: to WhatsApp Desktop) and silently does
 * nothing, and Outlook itself stops at 2083. Phones 4000: the apps take more; kept modest on purpose. A longer message
 * still opens the chat or the email, empty, with the message copied for pasting.
 */
export const LINK_LIMIT: Record<Platform, number> = { desktop: 2000, android: 4000, ios: 4000 }

export interface LinkOptions {
  /** Default: LINK_LIMIT for this device. */
  maxLength?: number
}

export interface MessageLink {
  url: string
  /** False when the message did not fit (LINK_LIMIT): the url opens an empty chat or email, so copy the message first. */
  filled: boolean
}

const REPLACEMENT = ch(0xfffd)

/** encodeURIComponent throws on a lone surrogate (half an emoji left by a cut); those become U+FFFD first. */
function wellFormed(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const n = s.charCodeAt(i + 1)
    if (c >= 0xd800 && c <= 0xdbff && n >= 0xdc00 && n <= 0xdfff) {
      out += s[i] + s[i + 1]
      i += 1
    } else out += c >= 0xd800 && c <= 0xdfff ? REPLACEMENT : s[i]
  }
  return out
}

const encode = (s: string): string => encodeURIComponent(wellFormed(s))

const limitOf = (opts?: LinkOptions): number => opts?.maxLength ?? LINK_LIMIT[detectPlatform()]

/**
 * https://wa.me/<number>?text=<message>. `phone` is the contact's phone field as saved (whatsappNumber picks the
 * number); null when it holds no number WhatsApp can open. New lines are kept (%0A); the text is otherwise as written.
 */
export function waLink(phone: string | null | undefined, text: string, opts?: LinkOptions): MessageLink | null {
  const n = whatsappNumber(phone)
  if (!n.ok) return null
  const base = `https://wa.me/${n.number}`
  const body = text.replace(/\r\n?/g, '\n')
  if (!body.trim()) return { url: base, filled: true }
  const url = `${base}?text=${encode(body)}`
  return url.length <= limitOf(opts) ? { url, filled: true } : { url: base, filled: false }
}

export interface MailDraft {
  /** One address, a field with several, or a list. */
  to: string | readonly (string | null | undefined)[] | null | undefined
  cc?: string | readonly (string | null | undefined)[] | null
  subject?: string | null
  body?: string | null
}

/** The @ stays readable; everything else that could end the address (, ? & # % and spaces) is encoded (RFC 6068). */
const address = (a: string): string => encode(a).replace(/%40/g, '@')

/**
 * mailto:<to>?cc=&subject=&body= with every part encoded (spaces %20, never +; new lines %0D%0A as RFC 6068 asks).
 * Null when `to` holds no address. Too long: the email opens with its recipients and subject and no body (`filled: false`).
 */
export function mailtoLink(draft: MailDraft, opts?: LinkOptions): MessageLink | null {
  const to = parseEmails(draft.to)
  if (to.length === 0) return null
  const already = new Set(to.map(a => a.toLowerCase()))
  const cc = parseEmails(draft.cc).filter(a => !already.has(a.toLowerCase()))
  const head: string[] = []
  if (cc.length) head.push(`cc=${cc.map(address).join(',')}`)
  const subject = (draft.subject ?? '').replace(/[\r\n]+/g, ' ').trim()
  if (subject) head.push(`subject=${encode(subject)}`)
  const base = `mailto:${to.map(address).join(',')}`
  const join = (q: string[]) => (q.length ? `${base}?${q.join('&')}` : base)
  const text = (draft.body ?? '').replace(/\r\n|\r|\n/g, '\r\n')
  if (!text.trim()) return { url: join(head), filled: true }
  const url = join([...head, `body=${encode(text)}`])
  return url.length <= limitOf(opts) ? { url, filled: true } : { url: join(head), filled: false }
}

/**
 * Opens a message link from inside a tap, as a real link click: no pop-up blocker, and no empty tab left behind for
 * mailto:. wa.me opens in a new tab so the CRM stays where it was; mailto: hands over to the mail app.
 */
export function openMessageLink(url: string): void {
  const a = document.createElement('a')
  a.href = url
  if (/^https?:/i.test(url)) {
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
  }
  a.hidden = true
  document.body.appendChild(a)
  try {
    a.click()
  } finally {
    a.remove()
  }
}
