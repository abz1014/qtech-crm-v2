import { useSession } from '@/app/session'
import { useMySignature } from '@/features/rfqs/hooks'
import { COMPANY_NAME, type ChaseSignature } from '@/features/rfqs/lib'

/** The signature of every chase message: the signed-in person's name, job title and phone, and the company. One source for every surface. */
export function useSignature(): ChaseSignature {
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const mine = useMySignature(user?.id)
  return { name: user?.name ?? COMPANY_NAME, company: COMPANY_NAME, jobTitle: mine.data?.jobTitle ?? null, phone: mine.data?.phone ?? null }
}
