import { useEffect, useId, useMemo, useRef, useState, type SelectHTMLAttributes } from 'react'
import { Camera, Check, ChevronDown, CircleAlert, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { businessToday } from '@/lib/dates'
import { intakeFiles, type AddedFile } from '@/lib/fileIntake'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { PaidByToggle } from '@/features/money/expenses/PaidByToggle'
import { useToast } from '@/ui/useToast'
import { Checkbox } from '@/ui/form/Checkbox'
import { DateInput } from '@/ui/form/DateInput'
import { controlClass } from '@/ui/form/fieldContext'
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
import {
  listTotals,
  MISC_TITLE_ERROR,
  MISC_TITLE_LABEL,
  miscCategories,
  miscFor,
  monthKey,
  monthKeyLabel,
  needsTitle,
  pkr,
  sortGroups,
  type Category,
  type PaidVia,
} from '@/features/money/expenses/model'
import { forMonthHelp } from '@/features/money/expenses/forMonth'
import { pickableCategories, quickInsert, quickProblem, sessionTotal, topCategories } from '@/features/money/expenses/quick'

/*
 * Quick add (redesign phase 1, owner: expenses are "utmost priority"). One row on the Expenses screen, open all the time:
 *   amount -> tap a category -> Save. The row stays open for the next one; the category stays chosen, so a second spend of the
 *   same kind is amount + Enter. "Office water Rs 500 cash": tap the amount, type 500, tap Water, tap Save (3 taps).
 * The six buttons are the categories used most in the last 30 days, then the everyday spends, and always "Other" (0091: a one-off
 * spend with a title typed in Detail, "What was it for?"). Typing what it was finds a category, or, when none matches, offers
 * Other: '<text>' under the group the words suggest. "More" lists every other one by group. Cash or bank comes from the category (one tap flips it). Date, detail, a receipt photo and "Has a GST invoice" (input tax,
 * 0025) are there but optional. A monthly bill (salaries, rent, a category with a monthly template) shows "This bill is for",
 * pre-filled with last month up to the 10th (expenses.period), and settles that month's template so it is not due again.
 * Supplier payments are not offered: Pay on the supplier order is their one door. The line above the row counts what was added
 * here and what was paid this month by the day paid (the Money "paid out" basis). 16 px text; 44 px taps.
 */
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']

/** sheetOpen: the Add expenses sheet is open over this form; its Save expenses is then the one green button, so this Save is drawn quiet. */
export function QuickAdd({ categories, sheetOpen = false }: { categories: readonly Category[]; sheetOpen?: boolean }) {
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

  const top = useMemo(() => topCategories(useQ.data ?? [], categories, 6, groupsQ.data ?? []), [useQ.data, categories, groupsQ.data])
  const others = useMemo(() => miscCategories(categories, groupsQ.data ?? []), [categories, groupsQ.data])
  const more = useMemo(() => {
    const shown = new Set(top.map(c => c.id))
    const rest = pickableCategories(categories).filter(c => !shown.has(c.id) && !c.isMisc)
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
  /** What is typed in "Or type what it was", and the field error on Detail of an Other with no title. */
  const [typed, setTyped] = useState('')
  const [titleError, setTitleError] = useState<string | null>(null)
  /** The For box, once changed: kept only for the date and category it was chosen for (it follows them otherwise). */
  const [forChoice, setForChoice] = useState<{ key: string; value: string } | null>(null)
  const [hasGst, setHasGst] = useState(false)
  const [tax, setTax] = useState<number | null>(null)
  const [photo, setPhoto] = useState<AddedFile | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ amount: number }[]>([])
  const [busy, setBusy] = useState(false)
  /** Bumped after each Save: the effect below puts the focus back on the (fresh) amount box once it is in the page. */
  const [refocus, setRefocus] = useState(0)
  const amountRef = useRef<HTMLInputElement | null>(null)
  const detailRef = useRef<HTMLInputElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const category = categories.find(c => c.id === categoryId)
  const paidVia: PaidVia = via ?? category?.defaultPaidVia ?? 'cash'
  const monthly = isMonthlyBill(categoryId, templates)
  const forKey = `${paidOn}|${categoryId}`
  const period = monthly ? (forChoice?.key === forKey ? forChoice.value : forMonthOf(paidOn, categoryId)) : null

  const isOther = !!category?.isMisc
  const matches = useMemo(() => {
    const q = typed.trim().toLowerCase()
    if (!q) return []
    const words = (c: Category) => c.name.toLowerCase().split(/[^a-z0-9]+/)
    return pickableCategories(categories)
      .filter(c => !c.isMisc && (c.name.toLowerCase().includes(q) || words(c).some(w => w.startsWith(q))))
      .slice(0, 5)
  }, [typed, categories])
  const otherFor = typed.trim() ? miscFor(typed, categories, groupsQ.data ?? []) : null

  const pick = (id: string) => {
    setCategoryId(id)
    setVia(null)
    setProblem(null)
    setTitleError(null)
    setTyped('')
    // an Other is filed under a title: the cursor goes to it (a typed word has already been put there)
    if (categories.find(c => c.id === id)?.isMisc) requestAnimationFrame(() => detailRef.current?.focus({ preventScroll: true }))
  }
  const pickOther = (c: Category, text: string) => {
    pick(c.id)
    setDetail(text.trim().replace(/\s+/g, ' '))
  }

  const reset = () => {
    setEntryId(crypto.randomUUID())
    setAmount(null)
    setDetail('')
    setTitleError(null)
    setHasGst(false)
    setTax(null)
    setPhoto(null)
    setVia(null)
    setProblem(null)
    setRefocus(n => n + 1)
  }

  // The amount box is a new element per entry (key={entryId}), so focusing it from reset() could hit the old, about-to-go one
  // (a frame can come before React's render) and the focus fell to <body>. Focus it after the commit that mounts it, and once
  // more on the next frame (the Save button leaves its busy state in the same pass). No keyboard-dismiss: the phone keyboard stays up.
  useEffect(() => {
    if (refocus === 0) return
    amountRef.current?.focus({ preventScroll: true })
    const id = requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) amountRef.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(id)
  }, [refocus])

  const save = async () => {
    if (busy) return
    if (paidOn > today) {
      setProblem('The date cannot be in the future.')
      return
    }
    const inputTax = hasGst ? (tax ?? 0) : 0
    const p = quickProblem({ amount, categoryId, inputTax, titleMissing: needsTitle(category, detail) })
    if (p === 'title') {
      setTitleError(MISC_TITLE_ERROR)
      detailRef.current?.focus()
      return
    }
    if (p) {
      setProblem(
        p === 'amount'
          ? 'Type the amount first.'
          : p === 'positive'
            ? 'The amount must be above zero.'
            : p === 'large'
              ? 'That amount is too large. Check it for an extra digit.'
              : p === 'category'
                ? 'Tap what it was for.'
                : 'The GST cannot be more than the amount.',
      )
      if (p === 'amount' || p === 'positive' || p === 'large') amountRef.current?.focus()
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
      if (m.message.startsWith('Write what it was for')) {
        setTitleError(MISC_TITLE_ERROR)
        return
      }
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
            {/* Words of their own (Amount (PKR), Paid on, Has a GST invoice): the Add expense dialog over this screen says
                Amount, PKR and Date paid, and one name must find one field. */}
            <label htmlFor={`${uid}-amount`} className="text-base font-medium">
              Amount (PKR)
            </label>
            <NumberInput
              // a fresh field per entry: the box is empty again after Save even though it gets the focus at once
              key={entryId}
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
                  aria-pressed={c.isMisc ? isOther : categoryId === c.id}
                  onClick={() => pick(c.id)}
                  className={cn(
                    'min-h-touch rounded border px-4 text-base font-medium transition-colors',
                    (c.isMisc ? isOther : categoryId === c.id) ? 'border-fg bg-selected text-fg' : 'border-line-strong bg-surface text-fg hover:bg-sunken',
                  )}
                >
                  {c.isMisc ? 'Other' : c.name}
                </button>
              ))}
              <QuickSelect
                aria-label="More categories"
                value={top.some(c => c.id === categoryId) ? '' : categoryId}
                onChange={e => e.target.value && pick(e.target.value)}
                className={cn('w-auto max-w-full px-4 pr-10 font-medium text-fg', categoryId && !top.some(c => c.id === categoryId) ? 'border-fg bg-selected' : 'border-line-strong bg-surface')}
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
              </QuickSelect>
            </div>
            <div className="grid gap-2" data-testid="quick-find">
              <label htmlFor={`${uid}-find`} className="text-base text-fg-2">
                Or type what it was
              </label>
              <input
                id={`${uid}-find`}
                value={typed}
                maxLength={80}
                placeholder="e.g. courier, tea, tyre"
                onChange={e => setTyped(e.target.value)}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  if (matches[0]) pick(matches[0].id)
                  else if (otherFor) pickOther(otherFor, typed)
                }}
                className="min-h-touch w-full min-w-0 rounded border border-line-input bg-surface px-3 text-base placeholder:text-fg-muted sm:max-w-sm"
              />
              {typed.trim() ? (
                <div className="flex flex-wrap gap-2">
                  {matches.map(c => (
                    <button key={c.id} type="button" onClick={() => pick(c.id)} className="min-h-touch rounded border border-line-strong bg-surface px-4 text-base font-medium hover:bg-sunken">
                      {c.name}
                    </button>
                  ))}
                  {matches.length === 0 && otherFor ? (
                    <button type="button" onClick={() => pickOther(otherFor, typed)} className="min-h-touch rounded border border-dashed border-fg bg-surface px-4 text-base font-medium hover:bg-sunken">
                      {`Other: '${typed.trim().replace(/\s+/g, ' ')}'`}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </fieldset>
        </div>

        {isOther && others.length > 1 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-base" data-testid="quick-other-group">
            <label htmlFor={`${uid}-other`} className="font-medium">
              Filed under
            </label>
            <QuickSelect id={`${uid}-other`} value={categoryId} onChange={e => setCategoryId(e.target.value)} className="w-auto">
              {others.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </QuickSelect>
            <span className="text-fg-2">Reports show it by what you write.</span>
          </div>
        ) : null}

        {monthly && period ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded border border-tone-info-fg/25 bg-tone-info-bg px-4 py-3 text-base" data-testid="quick-for-month">
            <label htmlFor={`${uid}-for`} className="font-medium">
              This bill is for
            </label>
            <QuickSelect id={`${uid}-for`} value={period} onChange={e => setForChoice({ key: forKey, value: e.target.value })} className="w-auto">
              {forMonthChoices(paidOn).map(o => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </QuickSelect>
            <span className="text-fg-2">
              {forMonthHelp(paidOn, categoryId)} Reports count it in that month.
            </span>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
          <div className="grid gap-2">
            <span className="text-base font-medium" aria-hidden="true">
              Paid by
            </span>
            <PaidByToggle value={paidVia} onChange={setVia} />
          </div>
          <div className="grid gap-2">
            <label htmlFor={`${uid}-date`} className="text-base font-medium">
              Paid on
            </label>
            {/* Shows "Tue 27 Oct 2026", takes 27 oct, 27/10, yesterday typed (Enter only reads the date; it does not Save). */}
            <DateInput
              id={`${uid}-date`}
              value={paidOn}
              defaultToday={false}
              onChange={v => v && setPaidOn(v)}
              onKeyDown={e => e.key === 'Enter' && e.preventDefault()}
              placeholder="e.g. 27 oct, yesterday"
              className="h-auto min-h-touch w-[13.5rem] text-base max-md:text-base"
            />
          </div>
          <div className="grid min-w-0 gap-2 lg:flex-1">
            <label htmlFor={`${uid}-detail`} className="text-base font-medium">
              {isOther ? (
                MISC_TITLE_LABEL
              ) : (
                <>
                  Detail <span className="font-regular text-fg-muted">optional</span>
                </>
              )}
            </label>
            <input
              id={`${uid}-detail`}
              ref={detailRef}
              value={detail}
              maxLength={200}
              aria-required={isOther || undefined}
              aria-invalid={titleError ? true : undefined}
              aria-describedby={titleError ? `${uid}-detail-err` : undefined}
              placeholder={isOther ? 'e.g. Courier from shop to office' : 'e.g. Office water, LEA-1234'}
              onChange={e => {
                setDetail(e.target.value)
                setTitleError(null)
              }}
              className={cn(
                'min-h-touch w-full min-w-0 rounded border bg-surface px-3 text-base placeholder:text-fg-muted',
                titleError ? 'border-tone-danger-fg bg-tone-danger-bg' : 'border-line-input',
              )}
            />
            {titleError ? (
              <p id={`${uid}-detail-err`} className="text-base text-tone-danger-fg">
                {titleError}
              </p>
            ) : null}
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
            <Button type="submit" variant={sheetOpen ? 'secondary' : 'primary'} size="touch" icon={Check} busy={busy} busyLabel="Saving" className="min-w-[112px] text-base">
              Save
              <span className="sr-only"> this expense</span>
            </Button>
          </div>
        </div>

        <div className="grid gap-3">
          <Checkbox label={<span className="text-base">Has a GST invoice</span>} checked={hasGst} onCheckedChange={c => setHasGst(c === true)} />
          {hasGst ? (
            <div className="flex flex-wrap items-center gap-3 rounded-row border bg-canvas px-4 py-3 text-base">
              <label htmlFor={`${uid}-tax`} className="font-medium">
                GST on this bill (input tax), PKR
              </label>
              <NumberInput id={`${uid}-tax`} value={tax} min={0} onChange={setTax} className="num h-[2.75rem] w-[10rem] text-base" />
              <span className="text-fg-2">Counts toward GST paid on purchases, so less GST to pay FBR.</span>
            </div>
          ) : null}
          <p className="text-base text-fg-2">
            Paying a supplier? Use <b className="font-medium text-fg">Pay</b> on the supplier order (or in We owe suppliers), so what we owe goes down.
          </p>
        </div>

        {problem ? (
          <p role="alert" className="flex items-center gap-2 rounded-row border border-tone-danger-fg/30 bg-tone-danger-bg px-3 py-2 text-base text-tone-danger-fg">
            <Icon icon={CircleAlert} />
            {problem}
          </p>
        ) : null}
      </form>
    </section>
  )
}

/** A native <select> (best list on a phone) drawn like the app's Select: same control look, chevron, 44 px tall, 16 px text. Kept local for the optgroups. */
function QuickSelect({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative min-w-0">
      <select {...rest} className={cn(controlClass, 'h-auto min-h-touch appearance-none pr-10 text-base max-md:text-base', className)}>
        {children}
      </select>
      <Icon icon={ChevronDown} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted" />
    </div>
  )
}
