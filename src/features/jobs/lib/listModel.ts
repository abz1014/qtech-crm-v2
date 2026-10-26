import type { JobRow } from '@/features/jobs/api'

/*
 * The Jobs list's view: three chips (Mine, Open, History) and a sort by what is due first. History is closed, settled or lost
 * work only (owner decision 1b): exactly the rows the database marks is_history, never anything else. A search ignores the chips
 * (a number must find its job wherever it is), and says which list each match is in.
 */
export const CHIPS = ['mine', 'open', 'history'] as const
export type Chip = (typeof CHIPS)[number]
export const isChip = (v: string | null): v is Chip => v !== null && (CHIPS as readonly string[]).includes(v)

export interface Who {
  userId: string | null
  role: 'admin' | 'sales' | 'engineer' | ''
}

/** Sales and engineers start on their own jobs; the admin on every open job. */
export const defaultChip = (role: Who['role']): Chip => (role === 'sales' || role === 'engineer' ? 'mine' : 'open')

/** A job is mine when I own it or (an engineer) I am put on its order. */
export function isMine(j: JobRow, who: Who): boolean {
  if (!who.userId) return false
  return j.ownerId === who.userId || j.engineerIds.includes(who.userId)
}

export function inChip(j: JobRow, chip: Chip, who: Who): boolean {
  if (chip === 'history') return j.isHistory
  if (j.isHistory) return false
  return chip === 'open' ? true : isMine(j, who)
}

export function chipCounts(all: readonly JobRow[], who: Who): Record<Chip, number> {
  return { mine: all.filter(j => inChip(j, 'mine', who)).length, open: all.filter(j => inChip(j, 'open', who)).length, history: all.filter(j => j.isHistory).length }
}

/** Newest activity first; ties by the newer job number. */
export function byRecent(a: JobRow, b: JobRow): number {
  return (b.lastActivityOn ?? '').localeCompare(a.lastActivityOn ?? '') || b.key.localeCompare(a.key, undefined, { numeric: true })
}

/** "Job 139", "Job O-45". */
export const jobLabel = (key: string) => `Job ${key}`
