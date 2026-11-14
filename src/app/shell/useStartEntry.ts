import { useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { PaletteContext } from '@/app/palette/usePalette'
import type { NewEntry } from '@/app/shell/newEntries'

/** Runs a Create row: Expense opens Quick add where the palette offers it, everything else is an address. */
export function useStartEntry() {
  const navigate = useNavigate()
  const quickExpense = useContext(PaletteContext)?.openQuickExpense
  return (e: NewEntry) => (e.id === 'expense' && quickExpense ? quickExpense() : navigate(e.to))
}
