import { z } from 'zod'
import { Check } from 'lucide-react'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { useToast } from '@/ui/useToast'
import { Checkbox } from '@/ui/form/Checkbox'
import { Form, FormField } from '@/ui/form/Form'
import { NumberInput } from '@/ui/form/NumberInput'
import { TextField } from '@/ui/form/TextField'
import { useSubmitForm } from '@/ui/form/useSubmitForm'
import { CategoryPicker } from '@/features/money/expenses/CategoryPicker'
import { useGroups, useInlineCategoryCreate, useSaveRecurring } from '@/features/money/expenses/hooks'
import type { Category, RecurringTemplate } from '@/features/money/expenses/model'

/** Add or edit a recurring template: what it is called, its category, the amount, and the day it usually falls on. */
const schema = z.object({
  label: z.string().trim().min(1, 'Name it, for example Rent'),
  categoryId: z.string().min(1, 'Choose a category'),
  amount: z.number({ invalid_type_error: 'Enter the amount', required_error: 'Enter the amount' }).positive('The amount must be above zero'),
  dayOfMonth: z.number().int().min(1, 'Use a day from 1 to 28').max(28, 'Use a day from 1 to 28').nullable(),
  startMonth: z.string().regex(/^(\d{4}-(0[1-9]|1[0-2]))?$/, 'Use the form 2026-11'),
  active: z.boolean(),
})
type Values = z.input<typeof schema>

export function RecurringDialog({ template, categories, onClose }: { template?: RecurringTemplate; categories: readonly Category[]; onClose: () => void }) {
  const save = useSaveRecurring()
  const groupsQ = useGroups()
  const createCategory = useInlineCategoryCreate(categories, groupsQ.data)
  const toast = useToast()
  const sf = useSubmitForm({
    schema,
    entity: 'recurring expense',
    defaultValues: {
      label: template?.label ?? '',
      categoryId: template?.categoryId ?? categories.find(c => c.active)?.id ?? '',
      amount: template?.amount ?? (undefined as unknown as number),
      dayOfMonth: template?.dayOfMonth ?? null,
      startMonth: template?.startMonth ?? '',
      active: template?.active ?? true,
    } satisfies Partial<Values>,
    onSubmit: (v, { requestId }) =>
      save.mutateAsync({
        id: template?.id,
        newId: template ? undefined : requestId,
        label: v.label,
        categoryId: v.categoryId,
        amount: v.amount,
        dayOfMonth: v.dayOfMonth,
        startMonth: v.startMonth || null,
        active: v.active,
        notes: template?.notes ?? null,
      }),
    onSuccess: v => {
      toast.toast({ title: template ? 'Saved recurring expense' : 'Added recurring expense', body: v.label, tone: 'success' })
      onClose()
    },
  })
  return (
    <Dialog open onOpenChange={o => !o && !sf.pending && onClose()} busy={sf.pending}>
      <DialogContent
        title={template ? 'Edit recurring expense' : 'Add recurring expense'}
        context="Shows as due each month until you record it"
        footer={
          <>
            <Button data-cancel variant="quiet" onClick={onClose} disabled={sf.pending}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form={sf.formId} icon={Check} busy={sf.pending} busyLabel="Saving">
              {sf.failed ? 'Try again' : 'Save'}
            </Button>
          </>
        }
      >
        <Form sf={sf} labels={{ label: 'Name', categoryId: 'Category', amount: 'Amount' }}>
          <FormField<Values, 'label'> name="label" label="Name">
            {f => <TextField {...f} placeholder="Rent" />}
          </FormField>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField<Values, 'categoryId'> name="categoryId" label="Category">
              {f => <CategoryPicker categories={categories} value={f.value} onChange={f.onChange} onCreate={createCategory} chevron />}
            </FormField>
            <FormField<Values, 'amount'> name="amount" label="Amount, PKR">
              {f => <NumberInput {...f} />}
            </FormField>
            <FormField<Values, 'dayOfMonth'> name="dayOfMonth" label="Day of the month" requirement="optional">
              {f => <NumberInput {...f} placeholder="1 to 28" />}
            </FormField>
            <FormField<Values, 'startMonth'> name="startMonth" label="Starts in" requirement="optional" help="Leave empty to start now.">
              {f => <TextField {...f} placeholder="2026-11" inputMode="numeric" />}
            </FormField>
          </div>
          <FormField<Values, 'active'> name="active" label={<span className="sr-only">Active</span>}>
            {f => <Checkbox label="Active (due each month)" checked={f.value} onCheckedChange={c => f.onChange(c === true)} />}
          </FormField>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
