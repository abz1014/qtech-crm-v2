import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { businessToday } from '@/lib/dates'
import { buildSupplierRecord, type SupplierRecord } from '@/features/companies/supplierRecord'
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

/** Quotes, deliveries and open items with this supplier (R18). Plain rows; supplierRecord.ts builds the display. */
export function useSupplierRecord(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.companies.part(id ?? '', 'supplier-record'),
    queryFn: () => api.getSupplierRecord(id as string),
    enabled: Boolean(id) && enabled,
  })
}

/** The one supplier-record read, turned into display rows once, for every panel that shows it (they share the cache entry). */
export function useSupplierRecordView(companyId: string, enabled = true) {
  const query = useSupplierRecord(companyId, enabled)
  const today = businessToday()
  const view = useMemo<SupplierRecord | null>(() => (query.data ? buildSupplierRecord(query.data, today) : null), [query.data, today])
  return { query, view, today }
}

/** How many times each of their brands was quoted ("quoted 4x"). */
export function useSupplierBrandQuotes(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.companies.part(id ?? '', 'supplier-brand-quotes'),
    queryFn: () => api.getSupplierBrandQuotes(id as string),
    enabled: Boolean(id) && enabled,
  })
}

/** `withPayment`: admin and sales also read which orders are past their payment date (engineers cannot, so it is never asked). */
export function useCompanyHistory(id: string | undefined, withPayment = false) {
  return useQuery({
    queryKey: [...qk.companies.part(id ?? '', 'history'), withPayment] as const,
    queryFn: () => api.getCompanyHistory(id as string, withPayment),
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

/** The company on file that sent an enquiry (findCompanyForSender), read once per sender. */
export function useCompanyForSender(hint: api.SenderHint | null) {
  const sig = hint ? JSON.stringify([hint.name, hint.domain, hint.emails, hint.phones]) : ''
  return useQuery({
    queryKey: qk.companies.sender(sig),
    queryFn: () => api.findCompanyForSender(hint as api.SenderHint),
    enabled: hint !== null,
    staleTime: 60_000,
  })
}

/** `contactName` (optional) adds a first contact in the same gesture, as the inline create in intake draws it. */
export function useCreateCompany() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: api.NewCompany & { contactName?: string | null }) => {
      try {
        let created: { id: string; name: string }
        try {
          created = await api.createCompany(input)
        } catch (err) {
          // A retry reuses the request id: the company is already saved (an earlier attempt failed after it, e.g. on the
          // contact), so carry on with the contact instead of ending as "already saved" without it.
          const e = err as { code?: string; message?: string }
          if (e?.code === '23505' && /companies_pkey/.test(e.message ?? '')) created = { id: input.id, name: input.name.trim() }
          else throw err
        }
        if (input.contactName?.trim()) await api.addContact({ id: crypto.randomUUID(), companyId: created.id, name: input.contactName })
        return created
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
    mutationFn: (patch: { name?: string; country?: string | null; city?: string | null; notes?: string | null }) => api.updateCompany(id, patch),
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
    mutationFn: (input: { id: string; name: string; siteId?: string | null; phone?: string | null; email?: string | null; jobTitle?: string | null; notes?: string | null }) =>
      api.addContact({ ...input, companyId }),
    onSuccess: () => invalidateAfter(client, 'contact.add', { companyId }),
  })
}

export function useUpdateSite(companyId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; name: string; address?: string | null }) => api.updateSite(input.id, input),
    onSuccess: () => invalidateAfter(client, 'site.update', { companyId }),
  })
}

export function useUpdateContact(companyId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; name: string; siteId?: string | null; phone?: string | null; email?: string | null; jobTitle?: string | null; notes?: string | null }) =>
      api.updateContact(input.id, input),
    onSuccess: () => invalidateAfter(client, 'contact.update', { companyId }),
  })
}

/** Throws api.InUseError (the database refuses; nothing is deleted) when RFQs or orders are filed under the site. */
export function useRemoveSite(companyId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.removeSite(companyId, id),
    onSuccess: () => invalidateAfter(client, 'site.remove', { companyId }),
  })
}

/** Throws api.InUseError (the database refuses; nothing is deleted) when RFQs, orders or quotations name the contact. */
export function useRemoveContact(companyId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.removeContact(companyId, id),
    onSuccess: () => invalidateAfter(client, 'contact.remove', { companyId }),
  })
}

export function useUnlinkBrand(companyId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (brandId: string) => api.unlinkBrand(companyId, brandId),
    onSuccess: () => invalidateAfter(client, 'brand.unlink', { companyId }),
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
