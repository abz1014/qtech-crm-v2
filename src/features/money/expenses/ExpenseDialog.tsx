import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Camera, Check, Lock } from 'lucide-react'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { businessToday } from '@/lib/dates'
import { intakeFiles, type AddedFile } from '@/lib/fileIntake'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { Combobox } from '@/ui/form/Combobox'
import { DateInput } from '@/ui/form/DateInput'
import { FileRow } from '@/ui/form/FileRow'
import { Form, FormField } from '@/ui/form/Form'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'
import { useSubmitForm } from '@/ui/form/useSubmitForm'
import { qk } from '@/features/queryKeys'
import { CategoryPicker } from '@/features/money/expenses/CategoryPicker'
import {
  useCategories,
  useDeleteReceipt,
  useInsertExpenses,
  useLastCategoryForOrder,
  useLegOptions,
  useMostUsedCategory,
  useOrderOptions,
  useReceipts,
  useUpdateExpense,
  useUploadReceipt,
} from '@/features/money/expenses/hooks'
import { InputTax } from '@/features/money/expenses/InputTax'
import {
  PAID_VIA_LABEL,
  SUPPLIER_PAYMENT_ID,
  paidViaFor,
  showsInputTax,
  type Category,
  type ListedExpense,
  type PaidVia,
} from '@/features/money/expenses/model'

/*
 * The one "Add expense" dialog (M03): opened on its own from Money, or with context from an order or a leg (O03, O07).
 * Pre-fills follow A3: from a leg, the category is Supplier payment, the payee and leg are filled and the amount is what is
 * still owed on the leg; from an order, the last category used on it; otherwise the most-used category of the last 30 days.
 * Date is today, paid via comes from the category. Amount, then Enter, saves. The same dialog edits an expense.
 *
 *   <AddExpenseDialog open={open} onOpenChange={setOpen}
 *     context={{ orderId, orderLabel: 'ORD-0038', legId, legLabel: 'leg A', payeeId, payeeName, amount: 384497,
 *                amountNote: 'Still owed on leg A: EUR 2,430.00 less the 412,300 advance' }} />
 */
export interface ExpenseContext {
  orderId?: string
  /** "ORD-0038". Looked up from the order id when left out. */
  orderLabel?: string
  legId?: string
  /** "leg A". */
  legLabel?: string
  /** The supplier on the leg: the payee, shown locked. */
  payeeId?: string
  payeeName?: string
  /** What to start the amount at (the leg's balance). */
  amount?: number
  /** Where that amount came from, shown under it. */
  amountNote?: string
  /** Overrides the category pre-fill. */
  categoryId?: string
}

interface AddExpenseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  context?: ExpenseContext
  /** Editing this expense instead of adding one. */
  expense?: ListedExpense
  onSaved?: () => void
}

export function AddExpenseDialog({ open, onOpenChange, context, expense, onSaved }: AddExpenseDialogProps) {
  const [busy, setBusy] = useState(false)
  const fromLeg = !!context?.legId
  const orderLabel = context?.orderLabel
  const sub = expense ? 'Edit expense' : [orderLabel, context?.legLabel].filter(Boolean).join(' · ') || 'Money › Expenses'
  return (
    <Dialog open={open} onOpenChange={onOpenChange} busy={busy}>
      <DialogContent title={expense ? 'Edit expense' : 'Add expense'} context={expense ? undefined : sub} size="md" className="md:w-[520px]">
        {open ? (
          <ExpenseForm
            context={context}
            expense={expense}
            fromLeg={fromLeg}
            onBusy={setBusy}
            onDone={() => {
              onOpenChange(false)
              onSaved?.()
            }}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

const schema = z
  .object({
    amount: z.number({ invalid_type_error: 'Enter the amount', required_error: 'Enter the amount' }).positive('The amount must be above zero'),
    categoryId: z.string().min(1, 'Choose a category'),
    paidOn: z.string().min(1, 'Choose a date'),
    paidVia: z.enum(['bank', 'cash']),
    note: z.string(),
    inputTax: z.number().min(0).nullable(),
    orderId: z.string().nullable(),
    legId: z.string().nullable(),
    payeeId: z.string().nullable(),
  })
  .refine(v => (v.inputTax ?? 0) <= v.amount, { path: ['inputTax'], message: 'Input tax cannot be more than what was paid' })

type Values = z.input<typeof schema>

interface FormProps {
  context?: ExpenseContext
  expense?: ListedExpense
  fromLeg: boolean
  onBusy: (b: boolean) => void
  onDone: () => void
  onCancel: () => void
}

/** Loads what the pre-fills need, then mounts the form once with them (a form's defaults are read once). */
function ExpenseForm(props: FormProps) {
  const { context, expense } = props
  const enabled = true
  const cats = useCategories(enabled)
  const used = useMostUsedCategory(!expense)
  const last = useLastCategoryForOrder(!expense && !props.fromLeg ? context?.orderId : null)
  const ready = cats.data && !used.isPending && (!context?.orderId || props.fromLeg || expense || !last.isPending)
  if (cats.isError) return <p role="alert" className="text-sm text-tone-danger-fg">The categories could not be loaded. Close this and try again.</p>
  if (!ready || !cats.data)
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </div>
    )
  return <ExpenseFormReady {...props} categories={cats.data} mostUsed={used.data ?? null} lastForOrder={last.data ?? null} />
}

function ExpenseFormReady({
  context,
  expense,
  fromLeg,
  categories,
  mostUsed,
  lastForOrder,
  onBusy,
  onDone,
  onCancel,
}: FormProps & { categories: Category[]; mostUsed: { id: string; count: number } | null; lastForOrder: string | null }) {
  const toast = useToast()
  const client = useQueryClient()
  const insert = useInsertExpenses()
  const update = useUpdateExpense()
  const uploadReceipt = useUploadReceipt()
  const today = businessToday()

  // ---- the pre-fills, and where each came from (FE-2)
  const pre = (() => {
    if (expense) return { categoryId: expense.categoryId, note: undefined as string | undefined }
    if (context?.categoryId) return { categoryId: context.categoryId, note: 'Chosen for you' }
    if (fromLeg) return { categoryId: SUPPLIER_PAYMENT_ID, note: 'Opened from a leg' }
    if (lastForOrder && context?.orderId)
      return { categoryId: lastForOrder, note: `Last used on ${context.orderLabel ?? 'this order'}` }
    if (mostUsed) return { categoryId: mostUsed.id, note: 'Most used in the last 30 days' }
    return { categoryId: categories.find(c => c.active)?.id ?? '', note: undefined }
  })()

  const sf = useSubmitForm({
    schema,
    entity: 'expense',
    defaultValues: {
      amount: expense?.amount ?? context?.amount ?? (undefined as unknown as number),
      categoryId: pre.categoryId,
      paidOn: expense?.paidOn ?? today,
      paidVia: expense?.paidVia ?? paidViaFor(pre.categoryId, categories),
      note: expense?.note ?? '',
      inputTax: expense?.inputTax ? expense.inputTax : null,
      orderId: expense?.orderId ?? context?.orderId ?? null,
      legId: expense?.legId ?? context?.legId ?? null,
      payeeId: expense?.payeeId ?? context?.payeeId ?? null,
    } satisfies Partial<Values>,
    // The month lock answers about the date, so the sentence sits under the date and everything typed stays.
    routeError: e => (e.kind === 'closed-month' ? { field: 'paidOn' } : undefined),
    onSubmit: async (v, { requestId }) => {
      const base = {
        amount_pkr: v.amount,
        category_id: v.categoryId,
        paid_on: v.paidOn,
        paid_via: v.paidVia as PaidVia,
        description: v.note.trim() || null,
        input_tax_pkr: showsInputTax(v.categoryId) ? (v.inputTax ?? 0) : 0,
        order_id: v.orderId,
        supplier_order_id: v.legId,
        payee_id: v.payeeId,
      }
      if (expense) {
        await update.mutateAsync({ id: expense.id, patch: base })
        if (photo && !photo.error) await uploadReceipt.mutateAsync({ expenseId: expense.id, file: photo.file }).catch(() => failedPhoto())
      } else {
        await insert.mutateAsync([{ id: requestId, ...base, reference: null }])
        if (photo && !photo.error) await uploadReceipt.mutateAsync({ expenseId: requestId, file: photo.file }).catch(() => failedPhoto())
      }
    },
    onSuccess: v => {
      const name = categories.find(c => c.id === v.categoryId)?.name ?? 'Expense'
      toast.toast({
        title: expense ? 'Saved expense' : 'Added expense',
        body: `PKR ${v.amount.toLocaleString('en-US')} · ${name}`,
        tone: 'success',
      })
      onDone()
    },
  })
  const failedPhoto = () =>
    toast.toast({ title: 'Saved, but the receipt photo did not upload', body: 'Open the expense and add the photo again.', tone: 'neutral' })

  const { form } = sf
  const [photo, setPhoto] = useState<AddedFile | null>(null)
  const [paidViaTouched, setPaidViaTouched] = useState(false)
  const [showNote, setShowNote] = useState(!!expense?.note)
  const [showPaidVia, setShowPaidVia] = useState(false)
  const [showTag, setShowTag] = useState(false)
  const amountRef = useRef<HTMLInputElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => onBusy(sf.pending), [sf.pending, onBusy])
  // Amount first: the person types it and presses Enter (A6.5: one expense in the default category).
  useEffect(() => {
    amountRef.current?.focus()
  }, [])

  const categoryId = form.watch('categoryId')
  const amount = form.watch('amount')
  const paidVia = form.watch('paidVia')
  const orderId = form.watch('orderId')
  const orders = useOrderOptions(showTag && !context?.orderId && !expense?.orderId)
  const legs = useLegOptions(orderId)
  const receipts = useReceipts(expense?.id)
  const deleteReceipt = useDeleteReceipt(expense?.id ?? '')
  const lockedPayee = !!context?.payeeId

  // Paid via follows the category until the person picks one.
  useEffect(() => {
    if (!paidViaTouched && !expense) form.setValue('paidVia', paidViaFor(categoryId, categories))
  }, [categoryId, categories, paidViaTouched, expense, form])

  const categorySource = form.formState.dirtyFields.categoryId ? undefined : pre.note

  const pickPhoto = async (files: FileList | null) => {
    if (!files?.length) return
    const [one] = await intakeFiles([files[0]], { accept: ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'] })
    setPhoto(one)
  }

  // Edit: a closed month freezes the expense; refresh the list afterwards so it shows the truth.
  useEffect(() => () => void client.invalidateQueries({ queryKey: qk.money.expenses.all }), [client])

  const amountField = (
    <FormField<Values, 'amount'> name="amount" label="Amount, PKR" source={context?.amountNote && !expense ? { label: context.amountNote } : undefined}>
      {f => (
        <NumberInput
          {...f}
          ref={r => {
            f.ref(r)
            amountRef.current = r
          }}
          inputMode="decimal"
        />
      )}
    </FormField>
  )
  const dateField = (
    <FormField<Values, 'paidOn'> name="paidOn" label="Date paid" source={{ label: 'Today', plain: true }}>
      {f => <DateInput {...f} />}
    </FormField>
  )

  return (
    <>
      <Form sf={sf} labels={{ amount: 'Amount', categoryId: 'Category', paidOn: 'Date paid' }} className="grid gap-4">
        {/* Enter in the amount saves: the form has several fields, so it needs a default button of its own for implicit submission. */}
        <button type="submit" hidden tabIndex={-1} />
        <div className="grid gap-4 md:grid-cols-2">
          <FormField<Values, 'categoryId'> name="categoryId" label="Category" source={categorySource ? { label: categorySource } : undefined}>
            {f => (
              <CategoryPicker
                categories={categories}
                value={f.value}
                onChange={f.onChange}
                chevron
              />
            )}
          </FormField>
          {lockedPayee ? (
            <div className="grid min-w-0 content-start gap-[6px]">
              <span className="text-sm font-medium leading-5 text-fg">Payee</span>
              <div className="flex h-control min-w-0 items-center justify-between gap-2 rounded border border-line-strong bg-sunken px-3 text-sm text-fg-2" aria-label="Payee, from the leg">
                <span className="truncate">
                  {context?.payeeName}
                  {context?.legLabel ? ` · ${context.legLabel}` : ''}
                </span>
                <Icon icon={Lock} className="text-fg-muted" />
              </div>
              <span className="text-xs leading-4 text-fg-2">From the leg</span>
            </div>
          ) : null}
          {amountField}
          {dateField}
        </div>

        {showNote ? (
          <FormField<Values, 'note'> name="note" label="Note" requirement="optional">
            {f => <TextField {...f} placeholder="What it was for" />}
          </FormField>
        ) : null}

        {showTag && !context?.orderId ? (
          <div className="grid gap-4 md:grid-cols-2">
            <FormField<Values, 'orderId'> name="orderId" label="Order" requirement="optional">
              {f => (
                <Combobox
                  options={(orders.data ?? []).map(o => ({ value: o.id, label: o.ref, meta: o.company }))}
                  value={f.value}
                  loading={orders.isPending}
                  placeholder="ORD-0038"
                  onChange={v => {
                    f.onChange(v)
                    form.setValue('legId', null)
                    form.setValue('payeeId', null)
                  }}
                />
              )}
            </FormField>
            {orderId && (legs.data?.length ?? 0) > 0 ? (
              <FormField<Values, 'legId'> name="legId" label="Leg" requirement="optional">
                {f => (
                  <Select
                    placeholder="No leg"
                    value={f.value ?? ''}
                    options={(legs.data ?? []).map(l => ({ value: l.id, label: `${l.label} · ${l.supplierName}` }))}
                    onChange={e => {
                      const leg = legs.data?.find(l => l.id === e.target.value)
                      f.onChange(leg?.id ?? null)
                      form.setValue('payeeId', leg?.supplierId ?? null)
                    }}
                  />
                )}
              </FormField>
            ) : null}
          </div>
        ) : null}

        {showsInputTax(categoryId) ? (
          <FormField<Values, 'inputTax'> name="inputTax" label={<span className="sr-only">Input tax</span>}>
            {f => <InputTax amount={typeof amount === 'number' ? amount : null} value={f.value ?? null} onChange={f.onChange} defaultOpen={!!expense?.inputTax} />}
          </FormField>
        ) : null}

        {showPaidVia ? (
          <FormField<Values, 'paidVia'> name="paidVia" label="Paid via" source={paidViaTouched ? undefined : { label: 'From the category' }}>
            {f => (
              <Select
                {...f}
                options={(Object.keys(PAID_VIA_LABEL) as PaidVia[]).map(v => ({ value: v, label: PAID_VIA_LABEL[v] }))}
                onChange={e => {
                  setPaidViaTouched(true)
                  f.onChange(e.target.value)
                }}
              />
            )}
          </FormField>
        ) : null}

        {photo ? <FileRow item={photo} onRemove={() => setPhoto(null)} /> : null}
        {(receipts.data ?? []).map(r => (
          <div key={r.id} className="flex items-center justify-between gap-3 rounded border border-line-strong px-3 py-2 text-sm">
            <span className="truncate">{r.fileName}</span>
            <Button size="sm" variant="quiet" onClick={() => deleteReceipt.mutate(r)} aria-label={`Remove ${r.fileName}`}>
              Remove
            </Button>
          </div>
        ))}

        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
          {!showNote ? (
            <span>
              <LinkButton onClick={() => setShowNote(true)}>Add a note</LinkButton>, optional.
            </span>
          ) : null}
          {!photo ? (
            <span>
              <LinkButton onClick={() => fileRef.current?.click()}>
                <Icon icon={Camera} size="chip" /> Add a receipt photo
              </LinkButton>
              , optional.
            </span>
          ) : null}
          {!showTag && !context?.orderId && !expense?.orderId ? (
            <span>
              <LinkButton onClick={() => setShowTag(true)}>Tag to an order</LinkButton>, optional.
            </span>
          ) : null}
          {!showPaidVia ? (
            <span>
              Paid via <b className="font-medium text-fg-2">{PAID_VIA_LABEL[paidVia as PaidVia]}</b>, from the category.{' '}
              <LinkButton onClick={() => setShowPaidVia(true)}>Change</LinkButton>
            </span>
          ) : null}
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          tabIndex={-1}
          aria-label="Receipt photo"
          className="sr-only"
          onChange={e => {
            void pickPhoto(e.target.files)
            e.target.value = ''
          }}
        />
      </Form>
      <div className="-mx-5 -mb-5 mt-1 flex items-center justify-end gap-2 border-t bg-sunken px-5 py-3 max-md:flex-col-reverse max-md:items-stretch">
        <Button variant="quiet" onClick={onCancel} data-cancel>
          Cancel
        </Button>
        <Button variant="primary" type="submit" form={sf.formId} icon={Check} busy={sf.pending} busyLabel="Saving">
          {sf.failed ? 'Try again' : 'Save expense'}
        </Button>
      </div>
    </>
  )
}

function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded font-medium text-primary underline-offset-2 hover:underline">
      {children}
    </button>
  )
}
