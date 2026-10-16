import { useCallback, useState } from 'react'
import { useSession } from '@/app/session'
import type { Density } from '@/ui/dataTableModel'

/*
 * The Comfortable / Compact switch on a DataTable, "kept per person" (components-06): one localStorage entry per
 * person and per table (`qtech.density.<person id>.<table label>`). Storage can be missing or throw (a private
 * window, blocked site data), so every read and write is in try/catch and the table simply starts at `fallback`.
 */
const read = (key: string): Density | null => {
  try {
    const v = window.localStorage.getItem(key)
    return v === 'compact' || v === 'comfortable' ? v : null
  } catch {
    return null
  }
}

export function useTableDensity(table: string, fallback: Density): [Density, (next: Density) => void] {
  const s = useSession()
  const key = `qtech.density.${s.status === 'signed-in' ? s.user.id : 'anon'}.${table}`
  const [state, setState] = useState<{ key: string; value: Density }>(() => ({ key, value: read(key) ?? fallback }))
  // A different person (or table) on the same mounted table: read their own setting.
  const value = state.key === key ? state.value : (read(key) ?? fallback)
  const set = useCallback(
    (next: Density) => {
      setState({ key, value: next })
      try {
        window.localStorage.setItem(key, next)
      } catch {
        /* not remembered, still applied */
      }
    },
    [key],
  )
  return [value, set]
}
