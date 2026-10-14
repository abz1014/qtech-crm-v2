import { resolveStatus, type ResolvedStatus } from '@/lib/status'

/** Resolve a status; fail loud while building, degrade quietly (null, logged) for the user in production. */
export function useResolved(dimension: string, value: string): ResolvedStatus | null {
  try {
    return resolveStatus(dimension, value)
  } catch (e) {
    if (!import.meta.env.PROD) throw e
    console.error(e)
    return null
  }
}
