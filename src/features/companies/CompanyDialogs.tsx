import type { ReactNode } from 'react'
import { MapPin, Pencil, UserPlus } from 'lucide-react'
import { z } from 'zod'
import { useAddContact, useAddSite, useUpdateCompany } from '@/features/companies/hooks'
import type { CompanyDetail, SiteRow } from '@/features/companies/api'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Form, FormField } from '@/ui/form/Form'
import { Select } from '@/ui/form/Select'
import { TextArea, TextField } from '@/ui/form/TextField'
import { useSubmitForm, type SubmitForm } from '@/ui/form/useSubmitForm'
import type { FieldValues } from 'react-hook-form'

/*
 * The small edit and add dialogs on the company page.
 *
 * FE-2 required fields, per dialog (for the commit):
 *   Edit company   name
 *   Add site       name (the address is optional)
 *   Add contact    name (phone, email, note and site are optional; the site is pre-filled when there is only one)
 */

function Shell<TIn extends FieldValues, TOut>({
  onOpenChange,
  title,
  context,
  icon,
  sf,
  submitLabel,
  children,
}: {
  onOpenChange: (o: boolean) => void
  title: string
  context?: string
  icon: typeof Pencil
  sf: SubmitForm<TIn, TOut>
  submitLabel: string
  children: ReactNode
}) {
  return (
    <DialogContent
      title={title}
      context={context}
      icon={icon}
      footer={
        <>
          <Button data-cancel onClick={() => onOpenChange(false)} disabled={sf.pending}>
            Cancel
          </Button>
          <Button type="submit" form={sf.formId} variant="primary" busy={sf.pending}>
            {sf.failed ? 'Try again' : submitLabel}
          </Button>
        </>
      }
    >
      {children}
    </DialogContent>
  )
}

// ---------------------------------------------------------------- edit company
const editSchema = z.object({
  name: z.string().trim().min(1, 'Enter the company name.'),
  country: z.string().trim().optional(),
  notes: z.string().trim().optional(),
})

export function EditCompanyDialog({ open, onOpenChange, company }: { open: boolean; onOpenChange: (o: boolean) => void; company: CompanyDetail }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>{open ? <EditBody onOpenChange={onOpenChange} company={company} /> : null}</Dialog>
}

function EditBody({ onOpenChange, company }: { onOpenChange: (o: boolean) => void; company: CompanyDetail }) {
  const update = useUpdateCompany(company.id)
  const sf = useSubmitForm({
    schema: editSchema,
    entity: 'company',
    defaultValues: { name: company.name, country: company.country ?? '', notes: company.notes ?? '' },
    onSubmit: v => update.mutateAsync({ name: v.name, country: v.country || null, notes: v.notes || null }),
    routeError: e =>
      e.kind === 'unique' ? { field: 'name', message: 'Another company already has this name. Merge them from the other company instead.' } : undefined,
    onSuccess: () => onOpenChange(false),
  })
  return (
    <Shell title="Edit company" context={company.name} icon={Pencil} onOpenChange={onOpenChange} sf={sf} submitLabel="Save changes">
      <Form sf={sf} labels={{ name: 'Company name' }}>
        <FormField name="name" label="Company name" requirement="required">
          {f => <TextField {...f} autoComplete="off" />}
        </FormField>
        <FormField name="country" label="Country" requirement="optional">
          {f => <TextField {...f} autoComplete="off" />}
        </FormField>
        <FormField name="notes" label="Notes" requirement="optional" help="Industry, lead source, anything the next person should know.">
          {f => <TextArea {...f} />}
        </FormField>
      </Form>
    </Shell>
  )
}

// ---------------------------------------------------------------- add site
const siteSchema = z.object({
  name: z.string().trim().min(1, 'Enter the site name, for example Karachi or Head office.'),
  address: z.string().trim().optional(),
})

export function AddSiteDialog({ open, onOpenChange, companyId, companyName }: { open: boolean; onOpenChange: (o: boolean) => void; companyId: string; companyName: string }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>{open ? <SiteBody onOpenChange={onOpenChange} companyId={companyId} companyName={companyName} /> : null}</Dialog>
}

function SiteBody({ onOpenChange, companyId, companyName }: { onOpenChange: (o: boolean) => void; companyId: string; companyName: string }) {
  const add = useAddSite(companyId)
  const sf = useSubmitForm({
    schema: siteSchema,
    entity: 'site',
    defaultValues: { name: '', address: '' },
    onSubmit: (v, { requestId }) => add.mutateAsync({ id: requestId, name: v.name, address: v.address || null }),
    routeError: e => (e.kind === 'unique' ? { field: 'name', message: `${companyName} already has a site with this name.` } : undefined),
    onSuccess: () => onOpenChange(false),
  })
  return (
    <Shell title="Add site" context={companyName} icon={MapPin} onOpenChange={onOpenChange} sf={sf} submitLabel="Add site">
      <Form sf={sf} labels={{ name: 'Site name' }}>
        <FormField name="name" label="Site name" requirement="required">
          {f => <TextField {...f} autoComplete="off" placeholder="Main plant" />}
        </FormField>
        <FormField name="address" label="Delivery address" requirement="optional">
          {f => <TextArea {...f} rows={2} />}
        </FormField>
      </Form>
    </Shell>
  )
}

// ---------------------------------------------------------------- add contact
const contactSchema = z.object({
  name: z.string().trim().min(1, 'Enter the contact name.'),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  siteId: z.string().optional(),
})

export function AddContactDialog({
  open,
  onOpenChange,
  companyId,
  companyName,
  sites,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  companyId: string
  companyName: string
  sites: readonly SiteRow[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <ContactBody onOpenChange={onOpenChange} companyId={companyId} companyName={companyName} sites={sites} /> : null}
    </Dialog>
  )
}

function ContactBody({ onOpenChange, companyId, companyName, sites }: { onOpenChange: (o: boolean) => void; companyId: string; companyName: string; sites: readonly SiteRow[] }) {
  const add = useAddContact(companyId)
  const onlySite = sites.length === 1 ? sites[0] : null
  const sf = useSubmitForm({
    schema: contactSchema,
    entity: 'contact',
    defaultValues: { name: '', phone: '', email: '', notes: '', siteId: onlySite?.id ?? '' },
    onSubmit: (v, { requestId }) =>
      add.mutateAsync({ id: requestId, name: v.name, phone: v.phone || null, email: v.email || null, notes: v.notes || null, siteId: v.siteId || null }),
    onSuccess: () => onOpenChange(false),
  })
  return (
    <Shell title="Add contact" context={companyName} icon={UserPlus} onOpenChange={onOpenChange} sf={sf} submitLabel="Add contact">
      <Form sf={sf} labels={{ name: 'Contact name' }}>
        <FormField name="name" label="Name" requirement="required">
          {f => <TextField {...f} autoComplete="off" />}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField name="phone" label="Phone or WhatsApp" requirement="optional">
            {f => <TextField {...f} type="tel" autoComplete="off" />}
          </FormField>
          <FormField name="email" label="Email" requirement="optional">
            {f => <TextField {...f} type="email" autoComplete="off" />}
          </FormField>
        </div>
        {sites.length > 0 ? (
          <FormField name="siteId" label="Site" requirement="optional" source={onlySite ? { label: `Only site on file: ${onlySite.name}` } : undefined}>
            {f => <Select {...f} placeholder="Any site" options={sites.map(s => ({ value: s.id, label: s.name }))} />}
          </FormField>
        ) : null}
        <FormField name="notes" label="Role or note" requirement="optional" help="For example: Finance, or WhatsApp is fine.">
          {f => <TextField {...f} autoComplete="off" />}
        </FormField>
      </Form>
    </Shell>
  )
}
