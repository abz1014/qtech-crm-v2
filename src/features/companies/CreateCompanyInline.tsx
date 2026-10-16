import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { z } from 'zod'
import { DuplicateCompanyError, useCreateCompany } from '@/features/companies/hooks'
import type { CompanyHit } from '@/features/companies/api'
import type { CreatedCompany } from '@/features/companies/CreateCompanyDialog'
import { Button } from '@/ui/Button'
import { Form, FormField } from '@/ui/form/Form'
import { TextField } from '@/ui/form/TextField'
import { useSubmitForm } from '@/ui/form/useSubmitForm'

/*
 * Inline create in the intake company picker (g2-intake-float, frame 2): the typed name, an optional City and an optional Contact
 * in one row, "Create and use", "Cancel", and a line saying the rest can wait. Nothing is required but the name (FE-2). The
 * company is saved as a prospect until its first order. City is companies.city.
 */
const schema = z.object({
  name: z.string().trim().min(1, 'Enter the company name.'),
  city: z.string().trim().optional(),
  contact: z.string().trim().optional(),
})

export function CreateCompanyInline({ initialName, onCreated, onCancel }: { initialName: string; onCreated: (c: CreatedCompany) => void; onCancel: () => void }) {
  const create = useCreateCompany()
  const [duplicate, setDuplicate] = useState<CompanyHit | null>(null)
  const savedId = useRef('')
  const sf = useSubmitForm({
    schema,
    entity: 'company',
    defaultValues: { name: initialName, city: '', contact: '' },
    onSubmit: async (v, { requestId }) => {
      setDuplicate(null)
      try {
        await create.mutateAsync({ id: requestId, name: v.name, city: v.city || null, contactName: v.contact || null })
      } catch (err) {
        if (err instanceof DuplicateCompanyError) setDuplicate(err.existing)
        throw err
      }
      savedId.current = requestId
    },
    routeError: e =>
      e.kind === 'unique' && /companies_name_key/.test(e.constraint ?? '') ? { field: 'name', message: 'A company with this name already exists.' } : undefined,
    onSuccess: v => onCreated({ id: savedId.current, name: v.name, city: v.city || null }),
  })
  return (
    <section aria-label="New company" className="m-1 grid gap-3 rounded border bg-sunken p-4">
      <Form sf={sf} labels={{ name: 'Company name' }}>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <FormField
            name="name"
            label="Company name"
            renderError={message =>
              duplicate ? (
                <>
                  {message}{' '}
                  <Link to={`/companies/${duplicate.id}`} className="font-medium text-primary underline underline-offset-2">
                    Open it
                  </Link>
                </>
              ) : (
                message
              )
            }
          >
            {f => <TextField {...f} autoComplete="off" autoCapitalize="words" autoFocus />}
          </FormField>
          <FormField name="city" label="City">
            {f => <TextField {...f} autoComplete="off" placeholder="Optional" />}
          </FormField>
          <FormField name="contact" label="Contact">
            {f => <TextField {...f} autoComplete="off" placeholder="Optional" />}
          </FormField>
        </div>
      </Form>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" form={sf.formId} variant="primary" size="sm" icon={Check} busy={sf.pending} busyLabel="Creating">
          {sf.formError ? 'Try again' : 'Create and use'}
        </Button>
        <Button variant="quiet" size="sm" onClick={onCancel} disabled={sf.pending}>
          Cancel
        </Button>
        <span className="text-xs text-fg-muted">City and contact can wait. Add them from the company page later.</span>
      </div>
    </section>
  )
}
