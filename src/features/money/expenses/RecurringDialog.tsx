import { z } from 'zod'
import { useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import { useSession } from '@/app/session'
import { mapPgError } from '@/lib/pgErrors'
import { amountSchema } from '@/lib/formRules'
import { Button } from '@/ui/Button'
import { ConfirmDelete } from '@/ui/ConfirmDelete'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { useToast } from '@/ui/useToast'
import { Checkbox } from '@/ui/form/Checkbox'
import { Form, FormField } from '@/ui/form/Form'
import { NumberInput } from '@/ui/form/NumberInput'
import { TextField } from '@/ui/form/TextField'
import { useSubmitForm } from '@/ui/form/useSubmitForm'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { CategoryPicker } from '@/features/money/expenses/CategoryPicker'
import { useDeleteRecurring, useGroups, useInlineCategoryCreate, useRecurringExpenseCount, useSaveRecurring } from '@/features/money/expenses/hooks'
import { PAID_VIA_LABEL, paidViaFor, pkr, type Category, type PaidVia, type RecurringTemplate } from '@/features/money/expenses/model'

/**
 * Add or edit a recurring template: what it is called, its category, the amount, and the day it usually falls on. An admin can
 * delete one (W12b, 0092): a confirm that says the expenses already recorded from it stay (a count, so it is not a guess), and
 * from then on it is not due any month. The expenses keep their amount, category and month, closed months included.
 */
const schema = z.object({
  label: z.string().trim().min(1, 'Name it, for example Rent'),
  categoryId: z.string().min(1, 'Choose a category'),
  amount: amountSchema('Enter the amount'),
  dayOfMonth: z.number().int().min(1, 'Use a day from 1 to 28').max(28, 'Use a day from 1 to 28').nullable(),
  startMonth: z.string().regex(/^(\d{4}-(0[1-9]|1[0-2]))?$/, 'Pick the month it starts, written like 2026-11.'),
  active: z.boolean(),
  paidVia: z.enum(['bank', 'cash']),
})
type Values = z.input<typeof schema>

export function RecurringDialog({ template, categories, onClose }: { template?: RecurringTemplate; categories: readonly Category[]; onClose: () => void }) {
  const save = useSaveRecurring()
  const groupsQ = useGroups()
  const createCategory = useInlineCategoryCreate(categories, groupsQ.data)
  const toast = useToast()
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const del = useDeleteRecurring()
  const [confirming, setConfirming] = useState(false)
  const used = useRecurringExpenseCount(template?.id, isAdmin && confirming)
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
      paidVia: template?.paidVia ?? (template ? paidViaFor(template.categoryId, categories) : 'bank'),
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
        paidVia: v.paidVia as PaidVia,
      }),
    onSuccess: v => {
      toast.toast({ title: template ? 'Saved recurring expense' : 'Added recurring expense', body: v.label, tone: 'success' })
      onClose()
    },
  })
  return (
    <>
    <Dialog open onOpenChange={o => !o && !sf.pending && onClose()} busy={sf.pending}>
      <DialogContent
        title={template ? 'Edit recurring expense' : 'Add recurring expense'}
        context="Shows as due each month until you record it"
        footer={
          <>
            {template && isAdmin ? (
              <Button variant="secondary" size="lg" icon={Trash2} className="mr-auto min-h-[44px] border-tone-danger-fg text-base text-tone-danger-fg max-md:mr-0" onClick={() => setConfirming(true)} disabled={sf.pending}>
                Delete recurring expense
              </Button>
            ) : null}
            <Button data-cancel variant="quiet" onClick={onClose} disabled={sf.pending}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form={sf.formId} icon={Check} busy={sf.pending} busyLabel="Saving">
              {sf.failed ? 'Try again' : 'Save'}
            </Button>
          </>
        }
      >
        <Form sf={sf} labels={{ label: 'Name', categoryId: 'Category', amount: 'Amount', dayOfMonth: 'Day of the month', startMonth: 'Starts in' }}>
          <FormField<Values, 'label'> name="label" label="Name">
            {f => <TextField {...f} placeholder="Rent" />}
          </FormField>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField<Values, 'categoryId'> name="categoryId" label="Category">
              {f => <CategoryPicker categories={categories} value={f.value} onChange={f.onChange} onCreate={createCategory} groups={groupsQ.data} chevron />}
            </FormField>
            <FormField<Values, 'amount'> name="amount" label="Amount, PKR">
              {f => <NumberInput {...f} />}
            </FormField>
            <FormField<Values, 'paidVia'> name="paidVia" label="Paid via">
              {f => (
                <SegmentedControl
                  aria-label="Paid via"
                  fill
                  value={f.value}
                  onValueChange={f.onChange}
                  options={(['cash', 'bank'] as const).map(v => ({ value: v, label: PAID_VIA_LABEL[v] }))}
                />
              )}
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
      {template && confirming ? (
        <ConfirmDelete
          open
          onOpenChange={o => {
            if (!o) setConfirming(false)
          }}
          thing={`“${template.label}”`}
          summary={
            <span data-testid="delete-recurring-what">
              {template.label} · {pkr(template.amount)} every month
              {used.data ? ` · ${used.data} ${used.data === 1 ? 'expense' : 'expenses'} recorded from it stay as they are` : ' · past expenses stay'}
            </span>
          }
          loading={used.isPending}
          onConfirm={async () => {
            await del.mutateAsync(template.id)
            toast.toast({ title: `Deleted ${template.label}`, body: 'It is no longer due each month. Past expenses stay.', tone: 'success' })
            onClose()
          }}
          errorMessage={e => mapPgError(e, { entity: 'recurring expense' }).message}
        />
      ) : null}
    </>
  )
}
