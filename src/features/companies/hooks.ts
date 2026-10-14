import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { invalidateAfter } from '@/features/invalidation'
import * as api from '@/features/companies/api'
import type { CompanyHit } from '@/features/companies/api'

/*
 * Companies hooks (R01 reference implementation). One hook per read, one per write. The pattern every
 * area follows (see src/features/README.md):
 *
 *   read   useQuery({ queryKey: qk.<area>..., queryFn: api.<call> })     keys come from the factory
 *   write  useMutation({ mutationFn: api.<call>, onSuccess: invalidateAfter(client, '<write>', vars) })
 *
 * A hook returns the TanStack result as it is (data, isPending, error, refetch). It does not copy server
 * data into state or context, and it does not decide what to refresh: the invalidation map does.
 */

export function useCompanyList() {
  return useQuery({ queryKey: qk.companies.list(), queryFn: api.listCompanies })
}

export function useCompany(id: string | undefined) {
  return useQuery({
    queryKey: qk.companies.detail(id ?? ''),
    queryFn: () => api.getCompany(id as string),
    enabled: Boolean(id),
  })
}

export function useCompanySites(id: string | undefined) {
  return useQuery({
    queryKey: qk.companies.part(id ?? '', 'sites'),
    queryFn: () => api.listSites(id as string),
    enabled: Boolean(id),
  })
}

export function useCompanyContacts(id: string | undefined) {
  return useQuery({
    queryKey: qk.companies.part(id ?? '', 'contacts'),
    queryFn: () => api.listContacts(id as string),
    enabled: Boolean(id),
  })
}

export function useCompanyBrands(id: string | undefined) {
  return useQuery({
    queryKey: qk.companies.part(id ?? '', 'brands'),
    queryFn: () => api.listCompanyBrands(id as string),
    enabled: Boolean(id),
  })
}

export function useBrands(enabled = true) {
  return useQuery({ queryKey: qk.brands.list(), queryFn: api.listBrands, enabled })
}

export function useSupplierStats(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.companies.part(id ?? '', 'supplier-stats'),
    queryFn: () => api.getSupplierStats(id as string),
    enabled: Boolean(id) && enabled,
  })
}

export function useSupplierActivity(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.companies.part(id ?? '', 'supplier-activity'),
    queryFn: () => api.getSupplierActivity(id as string),
    enabled: Boolean(id) && enabled,
  })
}

export function useCompanyHistory(id: string | undefined) {
  return useQuery({
    queryKey: qk.companies.part(id ?? '', 'history'),
    queryFn: () => api.getCompanyHistory(id as string),
    enabled: Boolean(id),
  })
}

/** Admin only. Pass `enabled: role === 'admin'`: for anyone else the query never runs, so no money is requested. */
export function useCompanyMoney(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.companies.part(id ?? '', 'money'),
    queryFn: () => api.getCompanyMoney(id as string),
    enabled: Boolean(id) && enabled,
  })
}

// ---------------------------------------------------------------- writes

/** Raised when a company with the same name already exists, carrying it so the form can offer "Open it". */
export class DuplicateCompanyError extends Error {
  readonly code = '23505'
  readonly existing: CompanyHit | null
  constructor(existing: CompanyHit | null) {
    super('duplicate key value violates unique constraint "companies_name_key"')
    this.name = 'DuplicateCompanyError'
    this.existing = existing
  }
}

export function useCreateCompany() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: api.NewCompany) => {
      try {
        return await api.createCompany(input)
      } catch (err) {
        const e = err as { code?: string; message?: string }
        if (e?.code === '23505' && /companies_name_key/.test(e.message ?? '')) {
          throw new DuplicateCompanyError(await api.findCompanyByName(input.name).catch(() => null))
        }
        throw err
      }
    },
    onSuccess: created => invalidateAfter(client, 'company.create', { id: created.id }),
  })
}

export function useUpdateCompany(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (patch: { name?: string; country?: string | null; notes?: string | null }) => api.updateCompany(id, patch),
    onSuccess: () => invalidateAfter(client, 'company.update', { id }),
  })
}

export function useAddSite(companyId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; name: string; address?: string | null }) => api.addSite({ ...input, companyId }),
    onSuccess: () => invalidateAfter(client, 'site.add', { companyId }),
  })
}

export function useAddContact(companyId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; name: string; siteId?: string | null; phone?: string | null; email?: string | null; notes?: string | null }) =>
      api.addContact({ ...input, companyId }),
    onSuccess: () => invalidateAfter(client, 'contact.add', { companyId }),
  })
}

/** Carry a brand: an existing one by id, or a new one by typing its name (created first, then linked). */
export function useCarryBrand(companyId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: { brandId: string } | { newName: string; id: string }) => {
      let brandId: string
      if ('brandId' in input) {
        brandId = input.brandId
      } else {
        const made = await api.createBrand({ id: input.id, name: input.newName })
        brandId = made.id
        await invalidateAfter(client, 'brand.create', {})
      }
      await api.linkBrand(companyId, brandId)
    },
    onSuccess: () => invalidateAfter(client, 'brand.link', { companyId }),
  })
}

export function useMergeCompanies() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { keepId: string; dropId: string }) => api.mergeCompanies(v.keepId, v.dropId),
    onSuccess: (_d, v) => {
      // The dropped company no longer exists: forget it instead of refetching a row that is gone.
      client.removeQueries({ queryKey: qk.companies.detail(v.dropId) })
      return invalidateAfter(client, 'company.merge', v)
    },
  })
}
