import { useMemo } from 'react'
import { Package } from 'lucide-react'
import { usePaletteSource } from '@/app/palette/usePalette'
import { searchOrders, type OrderHit } from '@/features/orders/api'
import { orderRef } from '@/lib/refs'
import type { PaletteItem, PaletteSource } from '@/ui/paletteSources'

/*
 * The Orders source of the command palette (O03): an order is found by its number ("38", "ORD-0038") or by the customer's PO
 * number (any part of it). It opens the order. It reads orders only, so no price or invoice number is involved and an engineer
 * may use it. Like the R12 search it waits for the keystroke burst to end and the palette cancels a request a newer
 * keystroke has replaced.
 */
export const ORDERS_DEBOUNCE_MS = 150

function pause(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve(false)
    const done = (ok: boolean) => {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve(ok)
    }
    const onAbort = () => done(false)
    const timer = window.setTimeout(() => done(true), ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function toOrderItem(h: OrderHit): PaletteItem {
  return {
    id: `order-${h.id}`,
    group: 'Orders',
    label: `${orderRef(h.number)} ${h.companyName}`,
    meta: h.customerPo ? `Customer PO ${h.customerPo}` : undefined,
    icon: Package,
    href: `/orders/${h.id}`,
  }
}

export function ordersPaletteSource(debounceMs = ORDERS_DEBOUNCE_MS): PaletteSource {
  return {
    id: 'orders',
    group: 'Orders',
    order: 20,
    search: async (query, signal) => {
      const q = query.trim()
      if (!q) return []
      if (!(await pause(debounceMs, signal))) return []
      const hits = await searchOrders(q, signal)
      if (signal.aborted) return []
      return hits.map(toOrderItem)
    },
  }
}

/** Register the Orders source for as long as the caller is mounted (the app shell mounts it for the whole session). */
export function useOrdersPaletteSource() {
  const source = useMemo(() => ordersPaletteSource(), [])
  usePaletteSource(source)
}
