import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { Camera, Check, CircleAlert, Keyboard, Landmark, Plus, Trash2, TriangleAlert, Wallet, X, CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'
import { businessToday } from '@/lib/dates'
import { parseDateText } from '@/lib/dateInput'
import { intakeFiles } from '@/lib/fileIntake'
import { formatDay, formatShortDate } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { useDirtyFlag } from '@/lib/pwa/dirtyForms'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { Kbd } from '@/ui/Kbd'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'
import { CategoryPicker } from '@/features/money/expenses/CategoryPicker'
import { useCategories, useInsertExpenses, useMostUsedCategory, useOrderOptions, useUploadReceipt } from '@/features/money/expenses/hooks'
import { InputTax } from '@/features/money/expenses/InputTax'
import { OrderTagPicker } from '@/features/money/expenses/OrderTagPicker'
import {
  PAID_VIA_LABEL,
  burstInserts,
  burstTotals,
  clearRowErrors,
  effectivePaidVia,
  invalidRows,
  isFilled,
  markClosedRows,
  newBurstRow,
  showsInputTax,
  type BurstRow,
  type Category,
  type OrderTagOption,
  type PaidVia,
} from '@/features/money/expenses/model'

/*
 * Burst entry (M11; g2-month-end "Burst expense entry, desktop" and "Phone 375"). A keyboard-first sheet for small
 * spends: one row per expense, one save for all of them or none.
 *
 *   Enter adds a row (the category carries over from the row above)   Tab moves to the next cell
 *   Ctrl+Enter saves all (one atomic insert, client ids: a double submit cannot duplicate)   Esc closes
 *
 * The first row's category is the most used in the last 30 days, the date is today, paid via is the category's own.
 * A closed month refuses the whole save; the sentence appears on the rows dated in it and every row keeps what it holds.
 * The Order cell (audit X1) is optional: a supplier payment typed here with no order is never counted against that order's margin,
 * so it is one Tab away after the note. Empty is fine; a number or a customer name narrows the list and Tab takes the first match.
 * Below 1024 px the grid becomes a list of cards with a 44 px camera button (the photo is compressed before upload).
 */
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']
const GRID = 'grid grid-cols-[28px_128px_minmax(0,1.25fr)_148px_164px_minmax(0,1.4fr)_132px_112px_32px] items-start gap-2 px-6'

const NO_ORDERS: readonly OrderTagOption[] = []
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

interface BurstSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BurstSheet({ open, onOpenChange }: BurstSheetProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {open ? <BurstContent onClose={() => onOpenChange(false)} /> : null}
    </RadixDialog.Root>
  )
}

function BurstContent({ onClose }: { onClose: () => void }) {
  const cats = useCategories()
  const used = useMostUsedCategory()
  const categories = cats.data
  const ready = !!categories && !used.isPending
  const today = businessToday()
  const compact = useMediaQuery('(max-width: 1023px)')
  const toast = useToast()
  const insert = useInsertExpenses()
  const orderQ = useOrderOptions(true)
  const orders: readonly OrderTagOption[] = orderQ.data ?? NO_ORDERS
  const uploadReceipt = useUploadReceipt()

  const defaults = useMemo(() => {
    const first = categories?.filter(c => c.active).sort((a, b) => a.sort - b.sort)[0]
    return { categoryId: used.data?.id ?? first?.id ?? '', today }
  }, [categories, used.data, today])

  const [rows, setRowsState] = useState<BurstRow[]>([])
  /**
   * The latest rows, updated the instant a cell changes them. Ctrl+Enter is read in the same keystroke as the cell's own
   * change (a category accepted by Enter), before React has rendered it, so Save reads this, never the render's copy.
   */
  const rowsRef = useRef<BurstRow[]>([])
  const setRows = useCallback((next: BurstRow[] | ((list: BurstRow[]) => BurstRow[])) => {
    rowsRef.current = typeof next === 'function' ? next(rowsRef.current) : next
    setRowsState(rowsRef.current)
  }, [])
  const [pending, setPending] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const lock = useRef(false)
  const focusId = useRef<string | null>(null)
  /**
   * What each desktop date cell holds that the rows do not hold yet. A typed date is read one tick after the cell loses focus
   * (the focus trap needs that tick), and not at all while the cell still has focus; a fast typist saves before either. Save
   * asks every cell for its text first, so the date saved is always the date on screen. Returns the ISO date, '' for text
   * that is not a date, or null when the cell has nothing pending.
   */
  const dateFlushers = useRef(new Map<string, () => string | null>())
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useDirtyFlag(rows.some(isFilled))

  // The first row, once the defaults are known.
  useEffect(() => {
    if (ready && rows.length === 0) {
      const r = newBurstRow(null, defaults)
      focusId.current = r.id
      setRows([r])
    }
  }, [ready, rows.length, defaults, setRows])

  // Focus follows a new row's amount.
  useEffect(() => {
    if (!focusId.current) return
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-row="${focusId.current}"] [data-cell="amount"]`)
    if (el) {
      el.focus()
      focusId.current = null
    }
  }, [rows])

  const patch = useCallback((id: string, p: Partial<BurstRow>) => {
    setRows(list => list.map(r => (r.id === id ? { ...r, ...p, error: p.error ?? undefined } : r)))
    setBanner(null)
  }, [setRows])

  const addRowAfter = (id: string) => {
    setRows(list => {
      const at = list.findIndex(r => r.id === id)
      if (at < 0 || !defaults) return list
      const next = newBurstRow(list[at], defaults)
      focusId.current = next.id
      return [...list.slice(0, at + 1), next, ...list.slice(at + 1)]
    })
  }

  const removeRow = (id: string) =>
    setRows(list => {
      if (list.length <= 1) return list
      return list.filter(r => r.id !== id)
    })

  const totals = burstTotals(rows)
  const badCount = rows.filter(r => r.error).length + invalidRows(rows).length

  const save = async () => {
    if (lock.current || !categories) return
    const latest = rowsRef.current
    const settled = latest.map(r => {
      const typed = dateFlushers.current.get(r.id)?.()
      return typed === null || typed === undefined || typed === r.date ? r : { ...r, date: typed, dateTyped: typed !== today }
    })
    if (settled.some((r, i) => r !== latest[i])) setRows(settled)
    const filled = settled.filter(isFilled)
    if (filled.length === 0) {
      setBanner('Type an amount on at least one row.')
      return
    }
    const unsavable = invalidRows(settled)
    if (unsavable.length > 0) {
      // Never save the others and quietly leave this one behind: nothing goes until every filled row has a date and a category.
      const noCategory = unsavable.filter(r => r.categoryText)
      const noOrder = unsavable.filter(r => r.orderText)
      setBanner(
        noCategory.length > 0
          ? `No category matches "${noCategory[0].categoryText}". Pick one from the list, then save.`
          : noOrder.length > 0
            ? `No order matches "${noOrder[0].orderText}". Pick one from the list or clear the Order cell, then save.`
            : unsavable.length === 1
            ? 'One row has no valid date. Fix it, then save.'
            : `${unsavable.length} rows have no valid date. Fix them, then save.`,
      )
      const first = noCategory[0] ?? noOrder[0] ?? unsavable[0]
      const target = first.categoryText ? '[role="combobox"]' : first.orderText ? '[data-cell="order"]' : '[data-cell="date"]'
      requestAnimationFrame(() => bodyRef.current?.querySelector<HTMLElement>(`[data-row="${first.id}"] ${target}`)?.focus())
      return
    }
    lock.current = true
    setPending(true)
    setBanner(null)
    setRows(clearRowErrors)
    try {
      const inserts = burstInserts(settled, categories)
      await insert.mutateAsync(inserts)
      // Photos go after the rows are in. A photo that fails never undoes an expense.
      const withPhoto = settled.filter(r => r.photo && !r.photo.error && inserts.some(i => i.id === r.id))
      const failed = (await Promise.all(withPhoto.map(r => uploadReceipt.mutateAsync({ expenseId: r.id, file: (r.photo as { file: File }).file }).then(() => false, () => true)))).filter(Boolean).length
      const n = inserts.length
      toast.toast({
        title: n === 1 ? 'Added 1 expense' : `Added ${n} expenses`,
        body: `PKR ${fmt(inserts.reduce((s, i) => s + i.amount_pkr, 0))}${failed ? ` · ${failed} receipt ${failed === 1 ? 'photo' : 'photos'} did not upload` : ''}`,
        tone: 'success',
      })
      onClose()
    } catch (err) {
      const m = mapPgError(err, { entity: 'expense' })
      if (m.kind === 'closed-month') {
        const marked = markClosedRows(settled, m.message)
        if (marked.some(r => r.error)) setRows(marked)
        else setBanner(m.message)
        focusFirstError(marked)
      } else if (m.kind === 'already-saved') {
        toast.toast({ title: 'Already saved', body: 'These expenses were added a moment ago.', tone: 'neutral' })
        onClose()
      } else {
        setBanner(`${m.message} Nothing was saved. Your rows are still here.`)
      }
    } finally {
      lock.current = false
      setPending(false)
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save

  const focusFirstError = (list: BurstRow[]) => {
    const bad = list.find(r => r.error)
    if (!bad) return
    requestAnimationFrame(() => bodyRef.current?.querySelector<HTMLElement>(`[data-row="${bad.id}"] [data-cell="date"]`)?.focus())
  }

  // Ctrl+Enter saves all, from anywhere in the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        void saveRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const rowKey = (e: React.KeyboardEvent, r: BurstRow) => {
    if (e.key !== 'Enter' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
    const t = e.target as HTMLElement
    if (t.tagName !== 'INPUT' || (t as HTMLInputElement).type === 'file') return
    if (!isFilled(r)) return // an empty row does not breed another
    e.preventDefault()
    addRowAfter(r.id)
  }

  const label = totals.count === 1 ? 'Save 1 expense' : `Save ${totals.count || ''} expenses`.replace('  ', ' ')

  const keyhints = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-2">
      <span className="inline-flex items-center gap-[6px]">
        <Kbd>Enter</Kbd>adds a row
      </span>
      <span className="inline-flex items-center gap-[6px]">
        <Kbd>Tab</Kbd>next cell
      </span>
      <span className="inline-flex items-center gap-[6px]">
        <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd>saves all
      </span>
      <span className="inline-flex items-center gap-[6px]">
        <Kbd>Esc</Kbd>closes
      </span>
    </div>
  )

  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay
        className={cn(
          'fixed inset-0 z-40 grid animate-fade-in justify-items-center overflow-y-auto bg-scrim',
          compact ? 'place-items-stretch p-0' : 'content-start px-4 pt-10',
        )}
      >
        <RadixDialog.Content
          onOpenAutoFocus={e => {
            e.preventDefault()
            requestAnimationFrame(() => bodyRef.current?.querySelector<HTMLElement>('[data-cell="amount"]')?.focus())
          }}
          onEscapeKeyDown={e => {
            if (pending) e.preventDefault()
          }}
          onInteractOutside={e => e.preventDefault()}
          aria-describedby="burst-desc"
          className={cn(
            'grid w-full grid-rows-[auto_auto_minmax(0,1fr)_auto] bg-surface focus:outline-none',
            compact
              ? 'min-h-dvh grid-rows-[auto_minmax(0,1fr)_auto]'
              : 'mb-10 max-w-[calc(100vw-2rem)] rounded shadow-modal md:w-[1320px]',
          )}
        >
          {compact ? (
            <header className="flex h-[52px] items-center gap-3 border-b pl-2 pr-4">
              <RadixDialog.Close asChild>
                <Button variant="quiet" size="touch" icon={X} aria-label="Close" disabled={pending} className="text-fg" />
              </RadixDialog.Close>
              <RadixDialog.Title className="flex-1 text-base font-semibold">Add expenses</RadixDialog.Title>
              <span id="burst-desc" className="sr-only">One card per expense. One save for all of them, or none.</span>
              <span className="num text-xs text-fg-muted">PKR {fmt(totals.total)}</span>
            </header>
          ) : (
            <>
              <header className="flex items-start gap-4 border-b px-6 pb-4 pt-5">
                <div className="grid flex-1 gap-[2px]">
                  <RadixDialog.Title className="text-lg font-semibold tracking-snug">Add expenses</RadixDialog.Title>
                  <RadixDialog.Description id="burst-desc" className="text-sm text-fg-muted">
                    Money › Expenses · one row per expense · one save for all of them, or none
                  </RadixDialog.Description>
                </div>
                <RadixDialog.Close asChild>
                  <Button variant="quiet" size="sm" icon={X} aria-label="Close" disabled={pending} className="-mr-2 text-fg-muted" />
                </RadixDialog.Close>
              </header>
              <div className="flex items-center gap-5 border-b bg-sunken px-6 py-2 text-xs text-fg-2">
                <span className="inline-flex items-center gap-[6px]">
                  <i aria-hidden="true" className="inline-block h-[14px] w-[28px] rounded-[3px] border border-dashed border-line-input bg-surface" />
                  Filled in for you. Type over it to change it.
                </span>
                <span className="inline-flex items-center gap-[6px]">
                  <i aria-hidden="true" className="inline-block h-[14px] w-[28px] rounded-[3px] border border-line-input bg-surface" />
                  You typed this
                </span>
                <span className="ml-auto inline-flex items-center gap-[6px]">
                  <Icon icon={Keyboard} size="sm" />
                  Keyboard only: no mouse needed
                </span>
              </div>
            </>
          )}

          <div ref={bodyRef} className={cn('min-h-0', compact && 'overflow-y-auto')}>
            {!ready || !categories ? (
              <div className="grid gap-3 p-6" aria-busy="true">
                <Skeleton className="h-[36px]" />
                <Skeleton className="h-[36px]" />
              </div>
            ) : cats.isError ? (
              <p role="alert" className="p-6 text-sm text-tone-danger-fg">The categories could not be loaded. Close this and try again.</p>
            ) : compact ? (
              <div className="grid gap-3 p-4">
                {rows.map((r, i) => (
                  <PhoneCard
                    key={r.id}
                    row={r}
                    index={i + 1}
                    categories={categories}
                    orders={orders}
                    today={today}
                    onPatch={p => patch(r.id, p)}
                    onKey={e => rowKey(e, r)}
                    onRemove={rows.length > 1 ? () => removeRow(r.id) : undefined}
                    count={rows.length}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => addRowAfter(rows[rows.length - 1].id)}
                  className="flex h-touch items-center justify-center gap-2 rounded border border-dashed border-line-input text-sm font-medium text-fg-2"
                >
                  <Icon icon={Plus} size="sm" />
                  Add a row
                </button>
              </div>
            ) : (
              <div role="group" aria-label="Expense rows">
                <div className={cn(GRID, 'h-[36px] items-end pb-[6px] text-xs font-medium text-fg-muted')} aria-hidden="true">
                  <span />
                  <span className="text-right">Amount, PKR</span>
                  <span>Category</span>
                  <span>Date</span>
                  <span>Paid via</span>
                  <span>Note</span>
                  <span>Order</span>
                  <span>Receipt photo</span>
                  <span />
                </div>
                {rows.map((r, i) => (
                  <SheetRow
                    key={r.id}
                    row={r}
                    index={i + 1}
                    categories={categories}
                    orders={orders}
                    today={today}
                    onPatch={p => patch(r.id, p)}
                    onKey={e => rowKey(e, r)}
                    onRemove={rows.length > 1 ? () => removeRow(r.id) : undefined}
                    count={rows.length}
                    dateFlushers={dateFlushers}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => addRowAfter(rows[rows.length - 1].id)}
                  className="mx-6 mb-4 mt-2 flex h-10 w-[calc(100%-3rem)] items-center gap-3 rounded border border-dashed border-line-input px-4 text-sm text-fg-2 hover:bg-sunken"
                >
                  <Icon icon={Plus} size="sm" />
                  Add a row
                  <Kbd className="ml-auto">Enter</Kbd>
                </button>
              </div>
            )}
            {banner ? (
              <p role="alert" className="mx-6 mb-4 flex items-center gap-2 rounded border border-tone-danger-fg/30 bg-tone-danger-bg px-3 py-2 text-sm text-tone-danger-fg max-lg:mx-4">
                <Icon icon={CircleAlert} />
                {banner}
              </p>
            ) : null}
          </div>

          {compact ? (
            <footer className="grid gap-2 border-t bg-surface px-4 pb-[max(var(--sp-4),env(safe-area-inset-bottom,0px))] pt-3">
              <Button variant="primary" size="touch" icon={Check} busy={pending} busyLabel="Saving" onClick={() => void save()} className="w-full text-base">
                {label}
              </Button>
              <p className="text-center text-xs text-fg-muted">One save for all rows. Photos are compressed before upload.</p>
            </footer>
          ) : (
            <footer className="flex flex-wrap items-center gap-4 rounded-b border-t bg-sunken px-6 py-3">
              {keyhints}
              <span className="flex-1" />
              {badCount > 0 ? (
                <span className="inline-flex h-5 items-center gap-[5px] rounded border border-tone-warning-fg/25 bg-tone-warning-bg pl-[6px] pr-2 text-xs font-medium text-tone-warning-fg">
                  <Icon icon={TriangleAlert} size="chip" />
                  {badCount} {badCount === 1 ? 'row needs' : 'rows need'} a change
                </span>
              ) : null}
              <span className="text-right text-sm text-fg-2" aria-live="polite">
                <span className="num font-medium text-fg">{totals.count}</span> {totals.count === 1 ? 'row' : 'rows'} · PKR <span className="num font-medium text-fg">{fmt(totals.total)}</span>
              </span>
              <RadixDialog.Close asChild>
                <Button variant="quiet" disabled={pending} data-cancel>
                  Cancel
                </Button>
              </RadixDialog.Close>
              <Button variant="primary" icon={Check} busy={pending} busyLabel="Saving" onClick={() => void save()}>
                {label}
                <span className="inline-flex items-center gap-[2px]" aria-hidden="true">
                  <Kbd className="h-[18px] min-w-[18px] border-primary-foreground/40 bg-primary-foreground/15 text-primary-foreground">Ctrl</Kbd>
                  <Kbd className="h-[18px] min-w-[18px] border-primary-foreground/40 bg-primary-foreground/15 text-primary-foreground">↵</Kbd>
                </span>
              </Button>
            </footer>
          )}
        </RadixDialog.Content>
      </RadixDialog.Overlay>
    </RadixDialog.Portal>
  )
}

// ====================================================================== desktop row

interface RowProps {
  row: BurstRow
  index: number
  categories: readonly Category[]
  orders: readonly OrderTagOption[]
  today: string
  onPatch: (p: Partial<BurstRow>) => void
  onKey: (e: React.KeyboardEvent) => void
  onRemove?: () => void
  /** How many rows the sheet holds, for "the other 4 rows are still here". */
  count: number
  /** Desktop only: where the row's date cell registers what it holds before the rows do. */
  dateFlushers?: React.MutableRefObject<Map<string, () => string | null>>
}

const defaultEdge = 'border-dashed bg-surface text-fg-2'

function SheetRow({ row, index, categories, orders, today, onPatch, onKey, onRemove, count, dateFlushers }: RowProps) {
  const paid = effectivePaidVia(row, categories)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const err = row.error
  return (
    <div data-row={row.id} role="group" aria-label={`Row ${index}`} onKeyDown={onKey} className={cn(GRID, 'py-2', err && 'bg-tone-danger-bg/40')}>
      <div className="num grid h-[36px] place-items-center text-xs text-fg-muted" aria-hidden="true">
        {index}
      </div>
      <NumberInput
        data-cell="amount"
        aria-label={`Amount, row ${index}`}
        value={row.amount}
        min={0.01}
        onChange={v => onPatch({ amount: v })}
        className="h-[36px]"
      />
      <CategoryPicker
        categories={categories}
        value={row.categoryId}
        aria-label={`Category, row ${index}`}
        size="cell"
        tag={row.categorySource === 'typed' ? undefined : row.categorySource === 'most-used' ? 'most used' : 'carried'}
        onChange={id => onPatch({ categoryId: id, categorySource: 'typed', categoryText: undefined })}
        onUnmatched={text => onPatch({ categoryText: text ?? undefined })}
      />
      <CellDate
        index={index}
        rowId={row.id}
        flushers={dateFlushers}
        value={row.date}
        today={today}
        typed={row.dateTyped}
        invalid={!!err}
        onChange={(date, typed) => onPatch({ date, dateTyped: typed })}
      />
      <div className="relative min-w-0">
        <Select
          aria-label={`Paid via, row ${index}`}
          value={paid}
          options={(Object.keys(PAID_VIA_LABEL) as PaidVia[]).map(v => ({ value: v, label: PAID_VIA_LABEL[v] }))}
          onChange={e => onPatch({ paidVia: e.target.value as PaidVia })}
          className={cn('h-[36px]', row.paidVia === null && defaultEdge)}
        />
        {row.paidVia === null ? (
          <span className="pointer-events-none absolute right-[28px] top-1/2 -translate-y-1/2 whitespace-nowrap text-xs leading-none text-fg-muted">from category</span>
        ) : null}
      </div>
      <TextField aria-label={`Note, row ${index}`} value={row.note} onChange={e => onPatch({ note: e.target.value })} className="h-[36px]" />
      <OrderTagPicker
        orders={orders}
        value={row.orderId}
        aria-label={`Order, row ${index}`}
        onChange={id => onPatch({ orderId: id, orderText: undefined })}
        onUnmatched={text => onPatch({ orderText: text ?? undefined })}
      />
      <div>
        {row.photo && !row.photo.error ? (
          <button
            type="button"
            title="Remove this photo"
            aria-label={`Remove receipt photo, row ${index}`}
            onClick={() => onPatch({ photo: null })}
            className="inline-flex h-[36px] w-full items-center justify-start gap-2 rounded border border-line-strong bg-surface pl-1 pr-3 text-xs font-medium hover:border-line-input hover:bg-sunken"
          >
            <PhotoThumb file={row.photo.file} className="size-[28px] rounded-[3px]" />
            Receipt
          </button>
        ) : (
          <button
            type="button"
            aria-label={`Add receipt photo, row ${index}`}
            onClick={() => fileRef.current?.click()}
            className="inline-flex h-[36px] w-full items-center justify-center gap-2 rounded border border-line-strong bg-surface px-3 text-xs font-medium hover:border-line-input hover:bg-sunken"
          >
            <Icon icon={Camera} className="text-fg-muted" />
            Photo
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onChange={async e => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            const [one] = await intakeFiles([f], { accept: PHOTO_TYPES })
            onPatch({ photo: one })
          }}
        />
      </div>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove row ${index}`}
          onClick={onRemove}
          className="grid h-[36px] w-8 place-items-center rounded text-fg-muted hover:bg-sunken hover:text-fg"
        >
          <Icon icon={Trash2} />
        </button>
      ) : (
        <span />
      )}
      {showsInputTax(row.categoryId) ? (
        <div className="col-start-3 col-end-9">
          <InputTax amount={row.amount} value={row.inputTax} onChange={v => onPatch({ inputTax: v })} />
        </div>
      ) : null}
      {err ? <ClosedError message={err} others={count - 1} /> : null}
    </div>
  )
}

function ClosedError({ message, others }: { message: string; others: number }) {
  return (
    <div
      role="alert"
      className="col-start-3 col-end-9 -mt-[2px] mb-2 flex items-start gap-3 rounded border border-tone-danger-fg/30 bg-tone-danger-bg px-4 py-3"
    >
      <Icon icon={CircleAlert} className="mt-[2px] text-tone-danger-fg" />
      <div className="grid gap-0">
        <b className="text-sm font-medium text-tone-danger-fg">{message}</b>
        <span className="text-xs text-fg-2">
          Nothing was saved. This row keeps what you typed; change the date or reopen {message.split(' ')[0]} in Month-end, then save again. {others === 1 ? 'The other row is still here.' : others > 1 ? `The other ${others} rows are still here.` : ''}
        </span>
      </div>
    </div>
  )
}

/** The date cell: "Fri 6 Nov" in mono, dashed with a "today" tag until it is typed over. Type 30 sep, 27/11, yesterday. */
function CellDate({
  index,
  rowId,
  flushers,
  value,
  today,
  typed,
  invalid,
  onChange,
}: {
  index: number
  rowId: string
  flushers?: React.MutableRefObject<Map<string, () => string | null>>
  value: string
  today: string
  typed: boolean
  invalid: boolean
  onChange: (date: string, typed: boolean) => void
}) {
  const show = (iso: string) => (iso && iso.slice(0, 4) !== today.slice(0, 4) ? `${formatShortDate(iso)} ${iso.slice(0, 4)}` : formatDay(iso))
  const [text, setText] = useState(show(value))
  const [editing, setEditing] = useState(false)
  const [bad, setBad] = useState(false)
  useEffect(() => {
    if (!editing && !bad) setText(show(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editing, bad])
  // What the cell holds, read by Save before the rows hear of it.
  const latest = useRef({ text, value, today })
  latest.current = { text, value, today }
  // What was typed and has not been read yet; survives the blur render, which puts the row's own date back in the box.
  const unread = useRef<string | null>(null)
  useEffect(() => {
    if (!flushers) return
    const map = flushers.current
    map.set(rowId, () => {
      const { text: t, value: v, today: d } = latest.current
      const trimmed = (unread.current ?? t).trim()
      if (trimmed === show(v)) return null // the cell shows the row's own date: nothing pending
      return (trimmed ? parseDateText(trimmed, d) : null) ?? ''
    })
    return () => {
      map.delete(rowId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushers, rowId])
  const commit = () => {
    const t = (unread.current ?? text).trim()
    unread.current = null
    const parsed = t ? parseDateText(t, today) : null
    if (parsed) {
      setBad(false)
      setText(show(parsed))
      if (parsed !== value) onChange(parsed, parsed !== today)
    } else {
      setBad(true)
      onChange('', true)
    }
  }
  const isDefault = !typed && value === today
  return (
    <div className="relative min-w-0">
      <input
        data-cell="date"
        aria-label={`Date, row ${index}`}
        aria-invalid={bad || invalid || undefined}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={text}
        onFocus={e => {
          setEditing(true)
          e.currentTarget.select()
        }}
        onChange={e => {
          unread.current = e.target.value
          setText(e.target.value)
          setBad(false)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
        }}
        onBlur={() => {
          setEditing(false)
          // Not inside the blur itself: a change that removes a node (the "today" tag, an error) while focus is between two
          // fields makes the dialog's focus trap pull focus back to the dialog. One tick later focus has landed.
          window.setTimeout(commit, 0)
        }}
        className={cn(
          'num h-[36px] w-full min-w-0 rounded border border-line-input bg-surface px-3 text-sm text-fg transition-colors duration-fast ease-out hover:border-fg-muted focus-visible:border-fg',
          'aria-[invalid=true]:border-tone-danger-fg aria-[invalid=true]:bg-tone-danger-bg',
          isDefault && defaultEdge,
          isDefault && 'pr-14',
        )}
      />
      {isDefault ? <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs leading-none text-fg-muted">today</span> : null}
    </div>
  )
}

function PhotoThumb({ file, className }: { file: File; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  return url ? <img src={url} alt="" className={cn('shrink-0 object-cover', className)} /> : <span className={cn('shrink-0 bg-selected', className)} />
}

// ====================================================================== phone card

function PhoneCard({ row, index, categories, orders, today, onPatch, onKey, onRemove }: RowProps) {
  const paid = effectivePaidVia(row, categories)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const hasPhoto = !!row.photo && !row.photo.error
  const dateText = row.date === today ? `Today, ${formatDay(row.date)}` : row.date ? formatShortDate(row.date, today) : 'Choose a date'
  const err = row.error
  return (
    <div
      data-row={row.id}
      role="group"
      aria-label={`Expense ${index}`}
      onKeyDown={onKey}
      className={cn('grid gap-3 rounded border bg-surface px-3 pb-4 pt-3', err && 'border-tone-danger-fg/45')}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_44px] items-center gap-3">
        <label className="flex h-[44px] items-center gap-2 rounded border border-line-input px-3 focus-within:border-fg">
          <span className="text-xs text-fg-muted">PKR</span>
          <NumberInput
            data-cell="amount"
            aria-label={`Amount, expense ${index}`}
            value={row.amount}
            min={0.01}
            onChange={v => onPatch({ amount: v })}
            className="num h-full flex-1 border-0 bg-transparent p-0 text-xl font-medium outline-none hover:border-0 focus-visible:border-0 focus-visible:outline-none"
          />
        </label>
        <button
          type="button"
          aria-label={hasPhoto ? `Remove receipt photo, expense ${index}` : `Take a receipt photo, expense ${index}`}
          onClick={() => (hasPhoto ? onPatch({ photo: null }) : fileRef.current?.click())}
          className={cn(
            'relative grid size-[44px] place-items-center rounded border',
            hasPhoto ? 'overflow-hidden border-tone-success-fg text-primary-foreground' : 'border-line-strong bg-surface text-fg-2',
          )}
        >
          {hasPhoto && row.photo ? <PhotoThumb file={row.photo.file} className="absolute inset-0 size-full" /> : null}
          <Icon icon={Camera} size="lg" className="relative" />
          {hasPhoto ? (
            <span className="absolute -right-[6px] -top-[6px] grid size-[18px] place-items-center rounded-round bg-tone-success-fg text-primary-foreground ring-2 ring-surface">
              <Check className="size-[11px]" strokeWidth={3} aria-hidden="true" />
            </span>
          ) : null}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onChange={async e => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            const [one] = await intakeFiles([f], { accept: PHOTO_TYPES })
            onPatch({ photo: one })
          }}
        />
      </div>
      <CategoryPicker
        categories={categories}
        value={row.categoryId}
        aria-label={`Category, expense ${index}`}
        size="phone"
        tag={row.categorySource === 'typed' ? undefined : row.categorySource === 'most-used' ? 'most used' : 'carried'}
        onChange={id => onPatch({ categoryId: id, categorySource: 'typed' })}
      />
      <div className="flex flex-wrap gap-2">
        <label
          className={cn(
            'relative inline-flex h-8 items-center gap-[6px] rounded-round border px-3 text-xs text-fg-2',
            !row.dateTyped && row.date === today ? 'border-dashed border-line-input' : 'border-line-input',
            err && 'border-tone-danger-fg',
          )}
        >
          <Icon icon={CalendarDays} size="chip" className="text-fg-muted" />
          {dateText}
          <input
            type="date"
            aria-label={`Date, expense ${index}`}
            value={row.date}
            onChange={e => e.target.value && onPatch({ date: e.target.value, dateTyped: e.target.value !== today })}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        <label className={cn('relative inline-flex h-8 items-center gap-[6px] rounded-round border px-3 text-xs text-fg-2', row.paidVia === null ? 'border-dashed border-line-input' : 'border-line-input')}>
          <Icon icon={paid === 'cash' ? Wallet : Landmark} size="chip" className="text-fg-muted" />
          {PAID_VIA_LABEL[paid]}
          <select
            aria-label={`Paid via, expense ${index}`}
            value={paid}
            onChange={e => onPatch({ paidVia: e.target.value as PaidVia })}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          >
            <option value="bank">Bank</option>
            <option value="cash">Cash</option>
          </select>
        </label>
        {onRemove ? (
          <button type="button" aria-label={`Remove expense ${index}`} onClick={onRemove} className="ml-auto grid size-8 place-items-center rounded text-fg-muted">
            <Icon icon={Trash2} />
          </button>
        ) : null}
      </div>
      <input
        aria-label={`Note, expense ${index}`}
        placeholder="Add a note, optional"
        value={row.note}
        onChange={e => onPatch({ note: e.target.value })}
        className="w-full rounded border-0 bg-transparent p-0 text-sm text-fg-2 placeholder:text-fg-muted focus-visible:outline-offset-4"
      />
      <OrderTagPicker
        orders={orders}
        value={row.orderId}
        size="phone"
        placeholder="Order, optional"
        aria-label={`Order, expense ${index}`}
        onChange={id => onPatch({ orderId: id, orderText: undefined })}
        onUnmatched={text => onPatch({ orderText: text ?? undefined })}
      />
      {showsInputTax(row.categoryId) ? <InputTax amount={row.amount} value={row.inputTax} onChange={v => onPatch({ inputTax: v })} /> : null}
      {err ? (
        <div role="alert" className="flex gap-2 rounded bg-tone-danger-bg px-3 py-2 text-xs text-fg-2">
          <Icon icon={CircleAlert} size="sm" className="mt-[1px] text-tone-danger-fg" />
          <span>
            <b className="font-medium text-tone-danger-fg">{err}</b> This row keeps what you typed.
          </span>
        </div>
      ) : null}
    </div>
  )
}
