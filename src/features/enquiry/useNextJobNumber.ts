import { useQuery } from '@tanstack/react-query'
import { requireSupabase } from '@/lib/supabase'
import { qk } from '@/features/queryKeys'

/*
 * "Create job 162": the number the next enquiry will most likely get. A job takes its RFQ's number (the RFQ number is given by the
 * database when it is saved), so this is the highest number plus one, read once when New enquiry opens. It is only the label on
 * the button: if somebody else saves first, the toast and the job page carry the number that was really given.
 */
export async function loadNextJobNumber(): Promise<number | null> {
  const db = requireSupabase()
  const { data, error } = await db.from('rfqs').select('number').order('number', { ascending: false }).limit(1)
  if (error) throw error
  const top = data?.[0]?.number
  return typeof top === 'number' ? top + 1 : 1
}

export function useNextJobNumber(enabled = true): number | null {
  const q = useQuery({ queryKey: [...qk.rfqs.all, 'next-job-number'], queryFn: loadNextJobNumber, enabled, staleTime: 0, gcTime: 0 })
  return q.data ?? null
}
