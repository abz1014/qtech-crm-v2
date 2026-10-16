import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Building2 } from 'lucide-react'
import { z } from 'zod'
import { DuplicateCompanyError, useCreateCompany } from '@/features/companies/hooks'
import type { CompanyHit, CompanyListRow } from '@/features/companies/api'
import { commonCountry } from '@/features/companies/commonCountry'
import { qk } from '@/features/queryKeys'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Form, FormField } from '@/ui/form/Form'
import { TextField } from '@/ui/form/TextField'
import { useSubmitForm } from '@/ui/form/useSubmitForm'

/*
 * Inline create (R02): one dialog, one required field. Used by the Companies screen and by intake
 * (R05) when the customer is not on file yet ("Add “Ind” as a new company" in the company picker).
 *
 * FE-2 entry burden, listed for the commit: required = name. Optional = country (pre-filled from where
 * most of your companies are when that is known, with the source shown). Sites, contacts and brands are
 * not asked for here: the first RFQ, the first enquiry or the company page adds them as a by-product.
 *
 * A name that already exists (the unique index ignores case and surrounding spaces) is not an error to
 * fight: the field says so plainly and offers "Open it".
 */
const schema = z.object({
  name: z.string().trim().min(1, 'Enter the company name.'),
  country: z.string().trim().optional(),
})

export interface CreatedCompany {
  id: string
  name: string
  /** Set by the inline create in the intake picker, which asks for it. */
  city?: string | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What was already typed (the picker's search text). Pre-fills the name. */
  initialName?: string
  /** Pre-fill for the country with where it came from, when the caller knows better than the roster does. */
  defaultCountry?: { value: string; source: string }
  /** Runs once the company exists. The caller decides what next (select it in intake, or open its page). */
  onCreated: (company: CreatedCompany) => void
}

export function CreateCompanyDialog(props: Props) {
  // Mount the form only while open, so each opening starts clean and pre-filled again.
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <CreateBody {...props} /> : null}
    </Dialog>
  )
}

function CreateBody({ onOpenChange, initialName = '', defaultCountry, onCreated }: Props) {
  const client = useQueryClient()
  const create = useCreateCompany()
  const [duplicate, setDuplicate] = useState<CompanyHit | null>(null)
  const savedId = useRef<string>('')

  const prefill = useMemo(() => {
    if (defaultCountry) return defaultCountry
    const common = commonCountry(client.getQueryData<CompanyListRow[]>(qk.companies.list()))
    return common ? { value: common, source: `Most of your companies are in ${common}` } : null
  }, [client, defaultCountry])

  const sf = useSubmitForm({
    schema,
    entity: 'company',
    defaultValues: { name: initialName, country: prefill?.value ?? '' },
    onSubmit: async (v, { requestId }) => {
      setDuplicate(null)
      try {
        await create.mutateAsync({ id: requestId, name: v.name, country: v.country || null })
      } catch (err) {
        if (err instanceof DuplicateCompanyError) setDuplicate(err.existing)
        throw err
      }
      savedId.current = requestId
    },
    routeError: e =>
      e.kind === 'unique' && /companies_name_key/.test(e.constraint ?? '')
        ? { field: 'name', message: 'A company with this name already exists.' }
        : undefined,
    onSuccess: v => {
      onOpenChange(false)
      onCreated({ id: savedId.current, name: v.name })
    },
  })

  return (
    <DialogContent
      title="New company"
      icon={Building2}
      context="Only the name is required."
      footer={
        <>
          <Button data-cancel onClick={() => onOpenChange(false)} disabled={sf.pending}>
            Cancel
          </Button>
          <Button type="submit" form={sf.formId} variant="primary" busy={sf.pending} busyLabel="Adding">
            {sf.formError ? 'Try again' : 'Add company'}
          </Button>
        </>
      }
    >
      <Form sf={sf} labels={{ name: 'Company name' }}>
        <FormField
          name="name"
          label="Company name"
          requirement="required"
          renderError={message =>
            duplicate ? (
              <>
                {message}{' '}
                <Link to={`/companies/${duplicate.id}`} onClick={() => onOpenChange(false)} className="font-medium text-primary underline underline-offset-2">
                  Open it
                </Link>
              </>
            ) : (
              message
            )
          }
        >
          {f => <TextField {...f} autoComplete="off" autoCapitalize="words" placeholder="Karachi Glassworks" />}
        </FormField>
        <FormField
          name="country"
          label="Country"
          requirement="optional"
          source={prefill ? { label: prefill.source } : undefined}
        >
          {f => <TextField {...f} autoComplete="off" placeholder="Pakistan" />}
        </FormField>
      </Form>
    </DialogContent>
  )
}
