/*
 * Recently opened RFQs (R22), kept on this device so the Capture pickers can list them first. The RFQ page records a visit;
 * Capture reads the list. Only ids and times: no names, no content.
 */
const KEY = 'qtech.recentRfqs'
const MAX = 12

export interface RecentVisit {
  id: string
  at: number
}

export function readRecents(): RecentVisit[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((r): r is RecentVisit => Boolean(r) && typeof (r as RecentVisit).id === 'string' && typeof (r as RecentVisit).at === 'number')
  } catch {
    return []
  }
}

export function recordRfqVisit(id: string, now = Date.now()): void {
  try {
    const next = [{ id, at: now }, ...readRecents().filter(r => r.id !== id)].slice(0, MAX)
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* private window: recents are a convenience */
  }
}

/** "2 hours ago", "yesterday", "3 days ago". */
export function openedAgo(at: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - at) / 60_000))
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins} minutes ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/** Recently opened orders (R22), same idea as the RFQs: ids and times only. */
const ORDER_KEY = 'qtech.recentOrders'

export function readRecentOrders(): RecentVisit[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(ORDER_KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((r): r is RecentVisit => Boolean(r) && typeof (r as RecentVisit).id === 'string' && typeof (r as RecentVisit).at === 'number')
  } catch {
    return []
  }
}

export function recordOrderVisit(id: string, now = Date.now()): void {
  try {
    const next = [{ id, at: now }, ...readRecentOrders().filter(r => r.id !== id)].slice(0, MAX)
    window.localStorage.setItem(ORDER_KEY, JSON.stringify(next))
  } catch {
    /* private window: recents are a convenience */
  }
}

/** Forget the recently opened RFQs and orders on this device (sign-out). */
export function clearRecents(): void {
  try {
    window.localStorage.removeItem(KEY)
    window.localStorage.removeItem(ORDER_KEY)
  } catch {
    /* private window: nothing was kept */
  }
}
