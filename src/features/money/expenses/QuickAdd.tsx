import { useId, useMemo, useRef, useState } from 'react'
import { Camera, Check, CircleAlert, Landmark, Wallet, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { businessToday } from '@/lib/dates'
import { intakeFiles, type AddedFile } from '@/lib/fileIntake'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { useToast } from '@/ui/useToast'
import { Checkbox } from '@/ui/form/Checkbox'
import { NumberInput } from '@/ui/form/NumberInput'
import {
  useCategoryUse,
  useExpenseMonth,
  useGroups,
  useInsertExpenses,
  useRecordedBills,
  useRecurring,
  useUploadReceipt,
} from '@/features/money/expenses/hooks'
import { forMonthChoices, forMonthOf, isMonthlyBill, templateToSettle } from '@/features/money/expenses/forMonth'
import { listTotals, monthKey, monthKeyLabel, pkr, sortGroups, type Category, type PaidVia } from '@/features/money/expenses/model'
import { pickableCategories, quickInsert, quickProblem, sessionTotal, topCategories } from '@/features/money/expenses/quick'

/*
 * Quick add (redesign phase 1, owner: expenses are "utmost priority"). One row on the Expenses screen, open all the time:
 *   amount -> tap a category -> Save. The row stays open for the next one; the category stays chosen, so a second spend of the
 *   same kind is amount + Enter. "Office water Rs 500 cash": tap the amount, type 500, tap Water, tap Save (3 taps).
 * The six buttons are the categories used most in the last 30 days, then the everyday spends; "More" lists every other one by
 * group. Cash or bank comes from the category (one tap flips it). Date, detail, a receipt photo and "Has a GST invoice" (input tax,
 * 0025) are there but optional. A monthly bill (salaries, rent, a category with a monthly template) shows "This bill is for",
 * pre-filled with last month up to the 10th (expenses.period), and settles that month's template so it is not due again.
 * Supplier payments are not offered: Pay on the supplier order is their one door. The line above the row counts what was added
 * here and what was paid this month by the day paid (the Money "paid out" basis). 16 px text; 44 px taps.
 */
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']

export function QuickAdd({ categories }: { categories: readonly Category[] }) {
  const today = businessToday()
  const toast = useToast()
  const uid = useId()
  const insert = useInsertExpenses()
  const upload = useUploadReceipt()
  const useQ = useCategoryUse()
  const groupsQ = useGroups()
  const templatesQ = useRecurring()
  const recordedQ = useRecordedBills(today)
  const month = useExpenseMonth(monthKey(today))
  const templates = useMemo(() => templatesQ.data ?? [], [templatesQ.data])

  const top = useMemo(() => topCategories(useQ.data ?? [], categories), [useQ.data, categories])
  const more = useMemo(() => {
    const shown = new Set(top.map(c => c.id))
    const rest = pickableCategories(categories).filter(c => !shown.has(c.id))
    return sortGroups(groupsQ.data ?? [])
      .map(g => ({ group: g, items: rest.filter(c => c.groupId === g.id).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)) }))
      .filter(g => g.items.length > 0)
  }, [categories, top, groupsQ.data])

  const [entryId, setEntryId] = useState(() => crypto.randomUUID())
  const [amount, setAmount] = useState<number | null>(null)
  const [categoryId, setCategoryId] = useState('')
  const [via, setVia] = useState<PaidVia | null>(null)
  const [paidOn, setPaidOn] = useState(today)
  const [detail, setDetail] = useState('')
  /** The For box, once changed: kept only for the date and category it was chosen for (it follows them otherwise). */
  const [forChoice, setForChoice] = useState<{ key: string; value: string } | null>(null)
  const [hasGst, setHasGst] = useState(false)
  const [tax, setTax] = useState<number | null>(null)
  const [photo, setPhoto] = useState<AddedFile | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ amount: number }[]>([])
  const [busy, setBusy] = useState(false)
  const amountRef = useRef<HTMLInputElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const category = categories.find(c => c.id === categoryId)
  const paidVia: PaidVia = via ?? category?.defaultPaidVia ?? 'cash'
  const monthly = isMonthlyBill(categoryId, templates)
  const forKey = `${paidOn}|${categoryId}`
  const period = monthly ? (forChoice?.key === forKey ? forChoice.value : forMonthOf(paidOn)) : null

  const pick = (id: string) => {
    setCategoryId(id)
    setVia(null)
    setProblem(null)
  }

  const reset = () => {
    setEntryId(crypto.randomUUID())
    setAmount(null)
    setDetail('')
    setHasGst(false)
    setTax(null)
    setPhoto(null)
    setVia(null)
    setProblem(null)
    requestAnimationFrame(() => amountRef.current?.focus())
  }

  const save = async () => {
    if (busy) return
    const inputTax = hasGst ? (tax ?? 0) : 0
    const p = quickProblem({ amount: amount ?? 0, categoryId, inputTax })
    if (p) {
      setProblem(p === 'amount' ? 'Type the amount first.' : p === 'category' ? 'Tap what it was for.' : 'The GST cannot be more than the amount.')
      if (p === 'amount') amountRef.current?.focus()
      return
    }
    const recorded = recordedQ.data
    const settles = period && recorded?.has(period) ? templateToSettle(categoryId, period, templates, recorded) : null
    const entry = { id: entryId, amount: amount as number, categoryId, paidOn, paidVia, detail, period, recurringId: settles?.id ?? null, inputTax }
    setBusy(true)
    setProblem(null)
    try {
      await insert.mutateAsync([quickInsert(entry)])
      let photoFailed = false
      if (photo && !photo.error) photoFailed = await upload.mutateAsync({ expenseId: entry.id, file: photo.file }).then(() => false, () => true)
      setSaved(s => [...s, { amount: entry.amount }])
      toast.toast({
        title: `Added: ${category?.name ?? 'Expense'}, ${pkr(entry.amount)}`,
        body: [paidVia === 'cash' ? 'Cash' : 'Bank', period && period !== monthKey(paidOn) ? `for ${monthKeyLabel(period)}` : null, photoFailed ? 'the receipt photo did not upload' : null]
          .filter(Boolean)
          .join(' · '),
        tone: 'success',
      })
      reset()
    } catch (err) {
      const m = mapPgError(err, { entity: 'expense' })
      setProblem(m.kind === 'already-saved' ? 'That one was already added.' : `${m.message} Nothing was saved; what you typed is still here.`)
      if (m.kind === 'already-saved') reset()
    } finally {
      setBusy(false)
    }
  }

  const here = sessionTotal(saved)
  const paidThisMonth = month.data ? listTotals(month.data.rows).total : null

  return (
    <section aria-labelledby={`${uid}-h`} className="grid gap-4 rounded border bg-surface p-4 md:p-5" data-testid="quick-add">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={`${uid}-h`} className="text-lg font-semibold">
          Quick add
        </h2>
        <p className="text-base text-fg-2" aria-live="polite" data-testid="quick-total">
          {here.count > 0 ? (
            <>
              Added here: <b className="num font-semibold text-fg">{here.count}</b>, <span className="num">{pkr(here.total)}</span>
              {' · '}
            </>
          ) : null}
          {paidThisMonth !== null ? (
            <>
              Paid in {monthKeyLabel(monthKey(today)).split(' ')[0]}: <span className="num font-medium text-fg">{pkr(paidThisMonth)}</span>, by the day paid
            </>
          ) : null}
        </p>
      </header>

      <form
        className="grid gap-4"
        autoComplete="off"
        onSubmit={e => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="grid content-start gap-2">
            <label htmlFor={`${uid}-amount`} className="text-base font-medium">
              Amount, PKR
            </label>
            <NumberInput
              id={`${uid}-amount`}
              ref={amountRef}
              value={amount}
              min={0.01}
              inputMode="decimal"
              enterKeyHint="done"
              placeholder="0"
              onChange={v => {
                setAmount(v)
                setProblem(null)
              }}
              className="num h-12 text-xl font-medium"
            />
          </div>
          <fieldset className="grid min-w-0 gap-2">
            <legend className="mb-2 text-base font-medium">
              What for <span className="font-regular text-fg-muted">· used most first</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {top.map(c => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={categoryId === c.id}
                  onClick={() => pick(c.id)}
                  className={cn(
                    'min-h-touch rounded border px-4 text-base font-medium transition-colors',
                    categoryId === c.id ? 'border-fg bg-selected text-fg' : 'border-line-strong bg-surface text-fg hover:bg-sunken',
                  )}
                >
                  {c.name}
                </button>
              ))}
              <select
                aria-label="More categories"
                value={top.some(c => c.id === categoryId) ? '' : categoryId}
                onChange={e => e.target.value && pick(e.target.value)}
                className={cn(
                  'min-h-touch max-w-full rounded border bg-surface px-3 text-base',
                  categoryId && !top.some(c => c.id === categoryId) ? 'border-fg bg-selected font-medium' : 'border-line-strong',
                )}
              >
                <option value="">More…</option>
                {more.map(g => (
                  <optgroup key={g.group.id} label={g.group.name}>
                    {g.items.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </fieldset>
        </div>

        {monthly && period ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded border border-tone-info-fg/25 bg-tone-info-bg px-4 py-3 text-base" data-testid="quick-for-month">
            <label htmlFor={`${uid}-for`} className="font-medium">
              This bill is for
            </label>
            <select
              id={`${uid}-for`}
              value={period}
              onChange={e => setForChoice({ key: forKey, value: e.target.value })}
              className="min-h-touch rounded border border-line-input bg-surface px-3 text-base"
            >
              {forMonthChoices(paidOn).map(o => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="text-fg-2">
              {Number(paidOn.slice(8, 10)) <= 10 ? 'Paid by the 10th, so last month.' : 'Paid after the 10th, so this month.'} Reports count it in that month.
            </span>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
          <div className="grid gap-2">
            <span className="text-base font-medium" aria-hidden="true">
              Paid by
            </span>
            <SegmentedControl
              aria-label="Paid by"
              value={paidVia}
              onValueChange={v => setVia(v as PaidVia)}
              large
              options={[
                { value: 'cash', label: 'Cash', icon: Wallet },
                { value: 'bank', label: 'Bank', icon: Landmark },
              ]}
            />
          </div>
          <div className="grid gap-2">
            <label htmlFor={`${uid}-date`} className="text-base font-medium">
              Date paid
            </label>
            <input
              id={`${uid}-date`}
              type="date"
              value={paidOn}
              max={today}
              onChange={e => e.target.value && setPaidOn(e.target.value)}
              className="num min-h-touch rounded border border-line-input bg-surface px-3 text-base"
            />
          </div>
          <div className="grid min-w-0 gap-2 lg:flex-1">
            <label htmlFor={`${uid}-detail`} className="text-base font-medium">
              Detail <span className="font-regular text-fg-muted">optional</span>
            </label>
            <input
              id={`${uid}-detail`}
              value={detail}
              maxLength={200}
              placeholder="e.g. Office water, LEA-1234"
              onChange={e => setDetail(e.target.value)}
              className="min-h-touch w-full min-w-0 rounded border border-line-input bg-surface px-3 text-base placeholder:text-fg-muted"
            />
          </div>
          <div className="flex items-end gap-2">
            {photo && !photo.error ? (
              <Button size="touch" icon={X} onClick={() => setPhoto(null)} className="text-base">
                Receipt added
              </Button>
            ) : (
              <Button size="touch" icon={Camera} onClick={() => fileRef.current?.click()} className="text-base">
                Receipt
              </Button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
              onChange={async e => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                const [one] = await intakeFiles([f], { accept: PHOTO_TYPES })
                setPhoto(one)
              }}
            />
            <Button type="submit" variant="primary" size="touch" icon={Check} busy={busy} busyLabel="Saving" className="min-w-[112px] text-base">
              Save
            </Button>
          </div>
        </div>

        <div className="grid gap-3">
          <Checkbox label={<span className="text-base">More: has a GST invoice</span>} checked={hasGst} onCheckedChange={c => setHasGst(c === true)} className="w-fit" />
          {hasGst ? (
            <div className="flex flex-wrap items-center gap-3 rounded border bg-canvas px-4 py-3 text-base">
              <label htmlFor={`${uid}-tax`} className="font-medium">
                GST on this bill (input tax), PKR
              </label>
              <NumberInput id={`${uid}-tax`} value={tax} min={0} onChange={setTax} className="num h-11 w-40 text-base" />
              <span className="text-fg-2">Counts toward GST paid on purchases, so less GST to pay FBR.</span>
            </div>
          ) : null}
          <p className="text-base text-fg-2">
            Paying a supplier? Use <b className="font-medium text-fg">Pay</b> on the supplier order (or in We owe suppliers), so what we owe goes down.
          </p>
        </div>

        {problem ? (
          <p role="alert" className="flex items-center gap-2 rounded border border-tone-danger-fg/30 bg-tone-danger-bg px-3 py-2 text-base text-tone-danger-fg">
            <Icon icon={CircleAlert} />
            {problem}
          </p>
        ) : null}
      </form>
    </section>
  )
}
