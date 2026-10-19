// What this browser session just copied: the channel, the moment and the text. The database keeps the stamp (the date, the
// count); the pane's "Chased today" card also shows "WhatsApp to Mr. Tariq, copied at 14:32" and the excerpt, which only
// this session knows. Reloading the page loses it and the card falls back to what the stamp holds.

export interface ChaseMemo {
  channel: 'whatsapp' | 'email'
  at: number
  text: string
}

const memos = new Map<string, ChaseMemo>()
const fresh = new Set<string>()

export function rememberChase(key: string, memo: ChaseMemo): void {
  memos.set(key, memo)
  fresh.add(key)
}

export function chaseMemo(key: string): ChaseMemo | undefined {
  return memos.get(key)
}

export function forgetChase(key: string): void {
  memos.delete(key)
  fresh.delete(key)
}

/** True for an item chased in this session (its Waiting row settles in with a green flash, as drawn). */
export function isFreshChase(key: string): boolean {
  return fresh.has(key)
}

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: false })

/** "14:32" in the business timezone. */
export function clockText(at: number | string | Date): string {
  return timeFmt.format(new Date(at))
}

/** The opening paragraph of a message, without the greeting and without the numbered list: what the "Chased today" card shows. */
export function excerptOf(text: string): string {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean).slice(1)
  const out: string[] = []
  for (const l of lines) {
    if (/^\d+\. /.test(l)) break
    out.push(l)
  }
  return out.join(' ')
}
