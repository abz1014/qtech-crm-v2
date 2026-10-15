import type { CompanyProfile } from '@/features/settings/companyProfile'

/**
 * What the company profile still lacks before a PDF may be made (DATA_MODEL 2.27): the legal name and the address, and
 * nothing else. Bank details, NTN and the rest are optional and print only when filled. Saving is never blocked by this.
 */
export function profileGaps(profile: Pick<CompanyProfile, 'legal_name' | 'address'> | null | undefined): string[] {
  const gaps: string[] = []
  if (!profile?.legal_name?.trim()) gaps.push('legal name')
  if (!profile?.address?.trim()) gaps.push('address')
  return gaps
}
