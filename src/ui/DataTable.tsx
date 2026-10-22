import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { Kbd } from '@/ui/Kbd'
import { blockingOverlayOpen, shortcutsEnabled } from '@/ui/useShortcutsSetting'
import { Checkbox } from '@/ui/form/Checkbox'
import { Money } from '@/ui/Money'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Skeleton } from '@/ui/Skeleton'
import { TruncateTip } from '@/ui/Tooltip'
import { useTableDensity } from '@/ui/useTableDensity'
import { downloadCSV, generateCSV } from '@/lib/csvExport'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { paisaToFixed } from '@/lib/money'
import {
  columnShowsPaisa,
  columnTotal,
  ERROR_MESSAGE,
  formatStamp,
  sortRows,
  tableCsvRows,
  DEFAULT_ROW_METRICS,
  formatSortParam,
  parseSortParam,
  readRowMetrics,
  type Column,
  type Density,
  type RowMetrics,
  type SortState,
} from '@/ui/dataTableModel'

export type { Column, Density, SortState } from '@/ui/dataTableModel'

/*
 * DataTable (D08 section 06; U04). Dense, sortable, keyboard-driven, with group
 * rows and a totals footer (the GST register), selection for batch actions (month
 * stamping, bank tick), an empty-state slot, loading and error bodies, and CSV
 * export through src/lib/csvExport.
 *
 * Totals and group subtotals are summed from the same rows that are drawn, in
 * paisa, so a total can never disagree with its rows.
 *
 * Performance: past `virtualAfter` rows (default 80) only the rows in view plus
 * an overscan are rendered, with spacer rows keeping the scroll height. Row
 * heights come from the density tokens (--row-h, --row-h-tall, --head-h: 48 / 56 / 40 at normal text,
 * 40 / 48 / 36 with smaller text, --row-h 40 or 32 when compact) read from the table's own computed style,
 * raised to the tallest row in view (a row with a small button is 49), and read again when the text size, the
 * pointer type or the window of rows changes (readRowMetrics in dataTableModel.ts).
 *
 * Phone cards: give `mobileRow` and, below 640px, each row is drawn as one stacked, tappable card
 * (whatever `mobileRow` returns) instead of table cells. The rows keep their keyboard focus, Enter to
 * open, Space and the checkbox for selection, and a 44px minimum height. The column header row is kept
 * for screen readers only, so sorting is a desktop control; group subtotals and the totals footer are
 * not drawn as cards (a group shows its label). Cards are not virtualised.
 *
 * Keyboard: Up/Down or J/K move the focus row, Home/End jump, PageUp/PageDown move
 * 10, Enter opens, Space ticks. Focus is a roving tabindex: one Tab stop for the body.
 * `/` focuses the filter (the field marked data-table-filter: see TableFilter, which also clears on Esc), and the row
 * you opened is focused again when you come back from its detail view (kept in sessionStorage per table label).
 *
 * Density: "Smaller text" in the account menu is the one density control (consistency spec 3.2), so the Comfortable / Compact
 * switch is off unless a table asks for it with `densitySwitch` (remembered per person and per table, useTableDensity).
 * `density` is the starting value.
 * Truncation: a column with `width` cuts long text with an ellipsis and shows the whole text in a tooltip.
 * Footer: "Showing 7 of 7 RFQs" (give `noun`, or your own `summary`) and the key legend, whenever rows can be focused; the
 * legend adds "/ search" when the toolbar holds a TableFilter.
 */
const OVERSCAN = 8
const PAGE = 10

type Item<T> =
  | { t: 'group'; key: string; label: ReactNode; rows: T[] }
  | { t: 'row'; row: T; di: number }

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: readonly T[]
  getRowId: (row: T) => string
  /** Names the table for assistive tech ("GST register"). */
  label: string
  /** Starting density; the switch (and the person's saved choice) takes over. Default comfortable. */
  density?: 'comfortable' | 'compact'
  /** Draw the Comfortable / Compact switch. Default: no (the account menu's Smaller text is the density control). */
  densitySwitch?: boolean
  /** Controlled sort. Omit to let the table hold it (starting from `defaultSort`). */
  sort?: SortState | null
  defaultSort?: SortState | null
  onSortChange?: (sort: SortState | null) => void
  /**
   * Keep the sort in the address under this search parameter (`?sort=due.asc`), so a refresh or Back keeps it. For the one
   * page-level list of a route only: a table in a dialog, or a second table on the page, leaves it out (or uses its own name).
   * Written with replace (no history entry per click), and only while it differs from `defaultSort`. Needs a router.
   */
  sortParam?: string
  /** Checkbox column for batch actions. Shift-click ticks a range; the header ticks everything loaded. */
  selection?: {
    selected: ReadonlySet<string>
    onChange: (next: Set<string>) => void
    rowLabel?: (row: T) => string
  }
  /** The row whose detail is open: bg-selected with the 3 px green edge. */
  activeRowId?: string | null
  onRowOpen?: (row: T) => void
  /** Group rows (month, leg...): label, subtotals for columns with `total`, and a group checkbox. */
  group?: (row: T) => { key: string; label: ReactNode }
  /** 'big': group rows are 40 px, semibold, on the sunken band (g2-month-end "Expenses by category"). Default: the quiet month row. */
  groupStyle?: 'quiet' | 'big'
  /** Totals footer label ("All 9 invoices shown"). The footer shows when any column has `total`. */
  footerLabel?: ReactNode
  /** What the rows are, plural ("RFQs"): names the loading line, the default error title and the default summary. */
  noun?: string
  /** All rows that match, when more than `rows` (a paged list): "Showing 25 of 61 RFQs". Default: rows.length. */
  total?: number
  /** Left of the bottom bar. Default with `noun`: "Showing 7 of 7 RFQs". */
  summary?: ReactNode
  /** Filters and actions above the table. A function receives the ticked count (batch bar). */
  toolbar?: ReactNode | ((ctx: { selectedCount: number }) => ReactNode)
  exportCsv?: { filename: string; label?: string }
  loading?: boolean
  /** title, message and the stamp have defaults ("Couldn’t load RFQs", "Your changes are safe...", the time the error first showed). */
  error?: { title?: string; message?: ReactNode; onRetry?: () => void; reference?: string; at?: Date } | null
  /** The empty-state slot. Say what is true and what happens next ("Every quotation is sent"). */
  empty?: ReactNode
  /** Scroll height once virtualised. Default 70vh. */
  maxHeight?: string
  virtualAfter?: number
  /** A band above the column headers that names runs of columns ("Sale to customer, PKR"). Drawn from lg up, where every column shows. Columns outside a band stay unlabelled. */
  columnBands?: ReadonlyArray<{ label: ReactNode; from: string; to: string }>
  /** Rows hold two-line cells (name over reference): 48 px as in the mockups. Required for virtualised tables with two-line cells. */
  twoLine?: boolean
  /** Below 640px, draw each row as a stacked card with this content instead of columns. */
  mobileRow?: (row: T) => ReactNode
  className?: string
}

export function DataTable<T>(props: DataTableProps<T>) {
  return props.sortParam && props.sort === undefined ? <AddressSortTable {...props} sortParam={props.sortParam} /> : <TableView {...props} />
}

/** A table whose sort lives in the address (`sortParam`): read on every render, written with replace. */
function AddressSortTable<T>(props: DataTableProps<T> & { sortParam: string }) {
  const { sortParam, columns, onSortChange } = props
  const defaultSort = props.defaultSort ?? null
  const [params, setParams] = useSearchParams()
  const fromAddress = parseSortParam(params.get(sortParam), columns.map(c => c.id))
  const sort = fromAddress === undefined ? defaultSort : fromAddress
  const change = (next: SortState | null) => {
    setParams(
      prev => {
        const out = new URLSearchParams(prev)
        const value = formatSortParam(next, defaultSort)
        if (value === null) out.delete(sortParam)
        else out.set(sortParam, value)
        return out
      },
      { replace: true },
    )
    onSortChange?.(next)
  }
  return <TableView {...props} sort={sort} onSortChange={change} />
}

function TableView<T>(props: DataTableProps<T>) {
  const {
    columns,
    rows,
    getRowId,
    label,
    selection,
    activeRowId,
    onRowOpen,
    group,
    groupStyle,
    columnBands,
    footerLabel,
    noun,
    total,
    toolbar,
    exportCsv,
    loading,
    error,
    empty,
    maxHeight = '70vh',
    virtualAfter = 80,
    twoLine,
    mobileRow,
    className,
  } = props
  const phone = useMediaQuery('(max-width: 639px)')
  const cards = !!mobileRow && phone
  const rootRef = useRef<HTMLDivElement>(null)
  const [savedDensity, setDensity] = useTableDensity(label, props.density ?? 'comfortable')
  const densityOn = (props.densitySwitch ?? false) && !cards
  const density = densityOn ? savedDensity : (props.density ?? 'comfortable')
  const hasError = !!error
  const errorAt = useMemo(() => (hasError ? new Date() : null), [hasError])
  const what = noun ?? label.toLowerCase()

  // ---- sort ---------------------------------------------------------------
  const [innerSort, setInnerSort] = useState<SortState | null>(props.defaultSort ?? null)
  const sort = props.sort !== undefined ? props.sort : innerSort
  const setSort = (next: SortState | null) => {
    if (props.sort === undefined) setInnerSort(next)
    props.onSortChange?.(next)
  }
  const cycleSort = (id: string) =>
    setSort(sort?.id !== id ? { id, dir: 'asc' } : sort.dir === 'asc' ? { id, dir: 'desc' } : null)

  // ---- order, groups, flat list ------------------------------------------
  const { items, dataRows, dataFlat } = useMemo(() => {
    const sortCol = sort ? columns.find(c => c.id === sort.id) : undefined
    const order = (list: readonly T[]) => (sortCol && sort ? sortRows(list, sortCol, sort.dir) : [...list])
    const out: Item<T>[] = []
    const data: T[] = []
    const flat: number[] = []
    const push = (row: T) => {
      flat.push(out.length)
      out.push({ t: 'row', row, di: data.length })
      data.push(row)
    }
    if (group) {
      const groups = new Map<string, { label: ReactNode; rows: T[] }>()
      for (const row of rows) {
        const g = group(row)
        const entry = groups.get(g.key)
        if (entry) entry.rows.push(row)
        else groups.set(g.key, { label: g.label, rows: [row] })
      }
      for (const [key, g] of groups) {
        const sorted = order(g.rows)
        out.push({ t: 'group', key, label: g.label, rows: sorted })
        sorted.forEach(push)
      }
    } else order(rows).forEach(push)
    return { items: out, dataRows: data, dataFlat: flat }
  }, [rows, columns, sort, group])

  const showPaisa = useMemo(() => new Map(columns.map(c => [c.id, columnShowsPaisa(c, rows)])), [columns, rows])

  // ---- windowing ----------------------------------------------------------
  const virtual = !cards && items.length > virtualAfter
  const [metrics, remeasure] = useRowMetrics(rootRef, density, virtual)
  const rowH = twoLine ? Math.max(metrics.tall, metrics.row) : metrics.row
  const groupH = Math.max(36, metrics.row - 4)
  const headH = metrics.head
  const offsets = useMemo(() => {
    const o = new Array<number>(items.length + 1)
    o[0] = 0
    for (let i = 0; i < items.length; i++) o[i + 1] = o[i] + (items[i].t === 'group' ? groupH : rowH)
    return o
  }, [items, rowH, groupH])

  const scrollRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  // Sideways scrolling only when the table really is wider than its box: a scroll box of its own would hold the sticky
  // header, so a list that fits lets the header stick to the page's scroll (#main) instead.
  const [fit, setFit] = useState<{ wide: boolean; width: number }>({ wide: false, width: 0 })
  useLayoutEffect(() => {
    const box = scrollRef.current
    const table = tableRef.current
    if (!box || !table || virtual) return
    const measure = () => {
      const width = box.clientWidth
      const wide = table.offsetWidth > width + 1
      setFit(prev => (prev.wide === wide && prev.width === width ? prev : { wide, width }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    ro.observe(table)
    return () => ro.disconnect()
  }, [virtual])
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(600)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !virtual) return
    const measure = () => el.clientHeight > 0 && setViewH(el.clientHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [virtual])

  const [first, last] = useMemo(() => {
    if (!virtual) return [0, items.length]
    const find = (y: number) => {
      let lo = 0
      let hi = items.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (offsets[mid + 1] <= y) lo = mid + 1
        else hi = mid
      }
      return lo
    }
    const y0 = Math.max(0, scrollTop - headH)
    return [Math.max(0, find(y0) - OVERSCAN), Math.min(items.length, find(y0 + viewH) + 1 + OVERSCAN)]
  }, [virtual, items.length, offsets, scrollTop, viewH, headH])
  // A new window of rows (scrolled, filtered, sorted) may hold a taller row: measure the rows now drawn.
  useLayoutEffect(() => {
    if (virtual) remeasure()
  }, [virtual, first, items.length, remeasure])

  // ---- keyboard focus -----------------------------------------------------
  const [focusDi, setFocusDi] = useState(0)
  const pendingFocus = useRef(false)
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  const safeFocus = Math.min(focusDi, Math.max(0, dataRows.length - 1))

  useLayoutEffect(() => {
    if (!pendingFocus.current) return
    pendingFocus.current = false
    bodyRef.current?.querySelector<HTMLElement>(`tr[data-di="${safeFocus}"]`)?.focus()
  })

  const moveTo = (di: number) => {
    const next = Math.max(0, Math.min(dataRows.length - 1, di))
    setFocusDi(next)
    pendingFocus.current = true
    const el = scrollRef.current
    if (virtual && el) {
      const flat = dataFlat[next]
      const top = headH + offsets[flat]
      const bottom = headH + offsets[flat + 1]
      let target = el.scrollTop
      if (top < target + headH) target = top - headH
      else if (bottom > target + viewH) target = bottom - viewH
      if (target !== el.scrollTop) {
        el.scrollTop = target
        setScrollTop(target)
      }
    }
  }

  // ---- "/" focuses the filter; the opened row is focused again on the way back ----------------------
  // Whether the toolbar holds a filter field, for the "/ search" key hint. Read whenever the toolbar changes: it is any node.
  const [hasFilter, setHasFilter] = useState(false)
  useEffect(() => {
    setHasFilter(!!rootRef.current?.querySelector('[data-table-filter]'))
  }, [props.toolbar])
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented || !shortcutsEnabled()) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return
      // A dialog or menu that is open (or has focus) keeps the key; the desktop Help panel beside the page does not.
      if (t?.closest?.('[role="dialog"],[role="alertdialog"]') || blockingOverlayOpen()) return
      const field = rootRef.current?.querySelector<HTMLInputElement>('[data-table-filter]')
      if (!field) return
      e.preventDefault()
      field.focus()
      field.select()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const memoryKey = `qtech.table.focus.${label}`
  const openRow = (row: T) => {
    try {
      window.sessionStorage.setItem(memoryKey, getRowId(row))
    } catch {
      /* not remembered */
    }
    onRowOpen?.(row)
  }
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || loading || dataRows.length === 0) return
    restored.current = true
    let id: string | null = null
    try {
      id = window.sessionStorage.getItem(memoryKey)
      window.sessionStorage.removeItem(memoryKey)
    } catch {
      /* nothing remembered */
    }
    const di = id === null ? -1 : dataRows.findIndex(r => getRowId(r) === id)
    if (di < 0) return
    const idle = !document.activeElement || document.activeElement === document.body
    if (idle) moveTo(di)
    else setFocusDi(di)
    // Runs once, when the first rows arrive: moveTo and the row ids are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, dataRows.length])

  // ---- selection ----------------------------------------------------------
  const selected = selection?.selected
  const lastTicked = useRef<string | null>(null)
  const ids = useMemo(() => dataRows.map(getRowId), [dataRows, getRowId])
  const setMany = (list: readonly string[], on: boolean) => {
    if (!selection) return
    const next = new Set(selection.selected)
    for (const id of list) {
      if (on) next.add(id)
      else next.delete(id)
    }
    selection.onChange(next)
  }
  const toggleRow = (id: string, shift: boolean) => {
    if (!selection) return
    const on = !selection.selected.has(id)
    if (shift && lastTicked.current !== null) {
      const a = ids.indexOf(lastTicked.current)
      const b = ids.indexOf(id)
      if (a >= 0 && b >= 0) {
        setMany(ids.slice(Math.min(a, b), Math.max(a, b) + 1), on)
        lastTicked.current = id
        return
      }
    }
    lastTicked.current = id
    setMany([id], on)
  }
  const selectedCount = selected ? ids.filter(id => selected.has(id)).length : 0
  const allOn = ids.length > 0 && selectedCount === ids.length
  const headState: boolean | 'indeterminate' = allOn ? true : selectedCount > 0 ? 'indeterminate' : false

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, di: number, row: T) => {
    if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return
    const go = (n: number) => {
      e.preventDefault()
      moveTo(n)
    }
    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        return go(di + 1)
      case 'ArrowUp':
      case 'k':
        return go(di - 1)
      case 'PageDown':
        return go(di + PAGE)
      case 'PageUp':
        return go(di - PAGE)
      case 'Home':
        return go(0)
      case 'End':
        return go(dataRows.length - 1)
      case 'Enter':
        if (onRowOpen) {
          e.preventDefault()
          openRow(row)
        }
        return
      case ' ':
        if (selection) {
          e.preventDefault()
          toggleRow(getRowId(row), e.shiftKey)
        }
    }
  }

  // ---- totals -------------------------------------------------------------
  const hasTotals = columns.some(c => c.total)
  const firstTotal = columns.findIndex(c => c.total)
  const renderTotal = useCallback(
    (col: Column<T>, list: readonly T[]): ReactNode => {
      if (!col.total) return null
      if (col.total !== true) return col.total([...list])
      const t = columnTotal(col, list)
      if (t === null) return null
      if (typeof t === 'bigint')
        return <Money value={paisaToFixed(t)} prefix={false} paisa={showPaisa.get(col.id) ? 'always' : 'auto'} strong />
      return <span className="num font-medium">{t.toLocaleString('en-US')}</span>
    },
    [showPaisa],
  )

  const renderCell = (col: Column<T>, row: T): ReactNode => {
    if (col.cell) return col.cell(row)
    const v = col.value?.(row)
    if (col.kind === 'money')
      return (
        <Money
          value={v === '' ? null : v}
          prefix={false}
          paisa={col.paisa && col.paisa !== 'column-auto' ? col.paisa : showPaisa.get(col.id) ? 'always' : 'auto'}
        />
      )
    if (v === null || v === undefined || v === '') return <span className="text-fg-muted">{'—'}</span>
    return typeof v === 'number' && col.kind === 'num' ? v.toLocaleString('en-US') : String(v)
  }

  // ---- render -------------------------------------------------------------
  const colCount = columns.length + (selection ? 1 : 0)
  const alignRight = (c: Column<T>) => (c.align ?? (c.kind === 'money' || c.kind === 'num' ? 'right' : 'left')) === 'right'
  const monoCell = (c: Column<T>) => c.kind === 'money' || c.kind === 'num' || c.kind === 'date'
  const cellBase = 'h-row whitespace-nowrap border-b border-line px-[var(--cell-px)] py-[6px] first:pl-5 last:pr-5'
  const hide = (c: Column<T>) => (c.hideClass ?? (c.hideBelowLg ? 'hidden lg:table-cell' : c.hideBelowMd ? 'hidden md:table-cell' : ''))

  const toolbarNode = typeof toolbar === 'function' ? toolbar({ selectedCount }) : toolbar
  const csv = () => {
    if (!exportCsv) return
    const { headers, rows: body } = tableCsvRows(columns, dataRows)
    downloadCSV(generateCSV(headers, body), exportCsv.filename)
  }

  // The U07 Checkbox, drawn without a visible label (the aria-label names it). The padded wrapper keeps a 44px touch target.
  const checkbox = (checked: boolean | 'indeterminate', onChange: (shift: boolean) => void, aria: string) => (
    <span className="-m-3 flex p-3">
      <Checkbox aria-label={aria} checked={checked} onClick={e => onChange(e.shiftKey)} />
    </span>
  )

  const labelCols = firstTotal < 0 ? columns.length : firstTotal
  const summaryRow = (kind: 'group' | 'foot', labelNode: ReactNode, list: readonly T[], key: string, groupIds?: string[]) =>
    cards ? (
      <tr key={key} role="row" data-row-kind={kind} className="block bg-canvas">
        <td role="cell" className="block border-b border-line px-4 py-2 text-xs font-medium text-fg-muted">
          {labelNode}
        </td>
      </tr>
    ) : (
    <tr
      key={key}
      data-row-kind={kind}
      style={kind === 'group' && virtual ? { height: groupH } : undefined}
      className={cn(
        kind === 'group'
          ? groupStyle === 'big'
            ? 'bg-sunken text-sm font-semibold text-fg'
            : 'bg-canvas text-xs font-medium text-fg-muted [&_.num]:text-fg-2'
          : 'bg-sunken font-medium',
      )}
    >
      {selection ? (
        <td className="h-9 w-10 border-b border-line px-[var(--cell-px)] first:pl-5 last:pr-5">
          {groupIds
            ? checkbox(
                groupIds.every(id => selected?.has(id)),
                () => setMany(groupIds, !groupIds.every(id => selected?.has(id))),
                `Select all in ${typeof labelNode === 'string' ? labelNode : 'group'}`,
              )
            : null}
        </td>
      ) : null}
      <td
        colSpan={labelCols}
        className={cn('h-9 whitespace-nowrap border-b border-line px-[var(--cell-px)] first:pl-5 last:pr-5', kind === 'foot' && 'border-t border-line-strong', kind === 'group' && groupStyle === 'big' && 'h-10 border-t border-line-strong')}
      >
        {labelNode}
      </td>
      {columns.slice(labelCols).map(c => (
        <td
          key={c.id}
          className={cn(
            'h-9 whitespace-nowrap border-b border-line px-[var(--cell-px)] first:pl-5 last:pr-5',
            kind === 'foot' && 'border-t border-line-strong',
            kind === 'group' && groupStyle === 'big' && 'h-10 border-t border-line-strong',
            alignRight(c) && 'text-right',
            hide(c),
          )}
        >
          {renderTotal(c, list)}
        </td>
      ))}
    </tr>
  )

  const renderItem = (item: Item<T>, flat: number) => {
    if (item.t === 'group')
      return summaryRow('group', item.label, item.rows, `g:${item.key}`, item.rows.map(getRowId))
    const { row, di } = item
    const id = getRowId(row)
    const ticked = !!selected?.has(id)
    const active = activeRowId === id
    if (cards && mobileRow)
      return (
        <tr
          key={id}
          role="row"
          data-di={di}
          data-card=""
          aria-selected={selection || activeRowId !== undefined ? ticked || active : undefined}
          tabIndex={di === safeFocus ? 0 : -1}
          onFocus={e => e.target === e.currentTarget && setFocusDi(di)}
          onKeyDown={e => onRowKey(e, di, row)}
          onClick={e => {
            if (onRowOpen && !(e.target as HTMLElement).closest('a,button,input,label,select,textarea')) openRow(row)
          }}
          className={cn(
            'relative block border-b border-line transition-colors focus-visible:bg-sunken focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-green',
            onRowOpen && 'cursor-pointer',
            ticked || active ? 'bg-selected' : 'active:bg-sunken',
            active && 'before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-brand-green',
          )}
        >
          <td role="cell" className="flex min-h-[44px] items-start gap-3 px-4 py-3">
            {selection ? <span className="pt-0.5">{checkbox(ticked, shift => toggleRow(id, shift), selection.rowLabel ? `Select ${selection.rowLabel(row)}` : 'Select row')}</span> : null}
            <div className="min-w-0 flex-1">{mobileRow(row)}</div>
          </td>
        </tr>
      )
    return (
      <tr
        key={id}
        data-di={di}
        aria-rowindex={virtual ? flat + 2 : undefined}
        aria-selected={selection || activeRowId !== undefined ? ticked || active : undefined}
        tabIndex={di === safeFocus ? 0 : -1}
        style={virtual ? { height: rowH } : undefined}
        onFocus={e => e.target === e.currentTarget && setFocusDi(di)}
        onKeyDown={e => onRowKey(e, di, row)}
        onClick={e => {
          if (onRowOpen && !(e.target as HTMLElement).closest('a,button,input,label,select,textarea')) openRow(row)
        }}
        className={cn(
          'transition-colors focus-visible:bg-sunken focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-green',
          onRowOpen && 'cursor-pointer',
          ticked || active ? 'bg-selected' : 'hover:bg-sunken',
        )}
      >
        {selection ? (
          <td className={cn(cellBase, 'relative w-10', active && 'before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-brand-green')}>
            {checkbox(ticked, shift => toggleRow(id, shift), selection.rowLabel ? `Select ${selection.rowLabel(row)}` : 'Select row')}
          </td>
        ) : null}
        {columns.map((c, ci) => (
          <td
            key={c.id}
            style={c.width !== undefined ? { maxWidth: c.width } : undefined}
            className={cn(
              cellBase,
              'relative',
              c.width !== undefined && 'truncate',
              alignRight(c) && 'text-right',
              monoCell(c) && 'num',
              hide(c),
              active && !selection && ci === 0 && 'before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-brand-green',
            )}
          >
            {c.width !== undefined ? <TruncateTip style={{ maxWidth: c.width }}>{renderCell(c, row)}</TruncateTip> : renderCell(c, row)}
          </td>
        ))}
      </tr>
    )
  }

  // An empty or error message spans the whole table; on a table wider than the screen it is held to the visible width, at
  // the left edge, so its words start on screen instead of centred in columns scrolled out of view.
  const pinned = (node: ReactNode) =>
    fit.wide && fit.width > 0 ? (
      <div data-table-message className="sticky left-0" style={{ width: fit.width }}>
        {node}
      </div>
    ) : (
      node
    )

  const body: ReactNode = (() => {
    if (error)
      return (
        <tr>
          <td colSpan={colCount}>
            {pinned(
            <EmptyState
              mood="error"
              title={error.title ?? `Couldn’t load ${what}`}
              actions={error.onRetry ? <Button variant="primary" icon={RefreshCw} onClick={error.onRetry}>Try again</Button> : undefined}
              meta={
                <>
                  {`Request failed · ${formatStamp(error.at ?? errorAt ?? new Date())}`}
                  {error.reference ? (
                    <>
                      {' · reference '}
                      <span className="num">{error.reference}</span>
                    </>
                  ) : null}
                </>
              }
            >
              {error.message ?? ERROR_MESSAGE}
            </EmptyState>,
            )}
          </td>
        </tr>
      )
    if (loading && cards)
      return Array.from({ length: 4 }, (_, r) => (
        <tr key={r} role="row" aria-hidden="true" className="block border-b border-line">
          <td role="cell" className="grid min-h-[44px] gap-2 px-4 py-3">
            <Skeleton style={{ width: `${[60, 75, 50, 68][r % 4]}%` }} />
            <Skeleton style={{ width: '40%' }} />
          </td>
        </tr>
      ))
    if (loading)
      return Array.from({ length: 6 }, (_, r) => (
        <tr key={r} aria-hidden="true">
          {selection ? <td className={cn(cellBase, 'w-10')} /> : null}
          {columns.map((c, ci) => (
            <td key={c.id} className={cn(cellBase, hide(c))}>
              <Skeleton className={cn(alignRight(c) && 'ml-auto')} style={{ width: `${[70, 90, 50, 80, 60][(r + ci) % 5]}%` }} />
            </td>
          ))}
        </tr>
      ))
    if (items.length === 0)
      return (
        <tr>
          <td colSpan={colCount}>{pinned(empty)}</td>
        </tr>
      )
    const slice = items.slice(first, last)
    return (
      <>
        {virtual && first > 0 ? (
          <tr aria-hidden="true" style={{ height: offsets[first] }}>
            <td colSpan={colCount} />
          </tr>
        ) : null}
        {slice.map((it, i) => renderItem(it, first + i))}
        {virtual && last < items.length ? (
          <tr aria-hidden="true" style={{ height: offsets[items.length] - offsets[last] }}>
            <td colSpan={colCount} />
          </tr>
        ) : null}
      </>
    )
  })()

  const showFoot = !cards && hasTotals && !loading && !error && items.length > 0
  // The key legend and "Showing n of n" are for rows that can be focused, so whenever there are rows to move through.
  const hints = !cards && !loading && !error && dataRows.length > 0
  const shown = props.summary ?? (noun && !loading && !error && dataRows.length > 0 ? (
    <>
      Showing <span className="num">{dataRows.length}</span> of <span className="num">{total ?? dataRows.length}</span> {noun}
    </>
  ) : undefined)
  // WCAG 4.1.3: a filter changes the count silently. One polite node, on the page from the start, says each new count
  // (not the first one: the page itself is being read then). Polite announcements of quick typing coalesce in screen readers.
  const countText = loading || error ? '' : `Showing ${dataRows.length} of ${total ?? dataRows.length} ${noun ?? 'rows'}`
  const [firstCount, setFirstCount] = useState<string | null>(null)
  useEffect(() => {
    if (firstCount === null && countText) setFirstCount(countText)
  }, [countText, firstCount])
  const announced = firstCount !== null && countText !== firstCount ? countText : ''

  return (
    <div
      ref={rootRef}
      data-table-root
      data-density={density === 'compact' ? 'compact' : undefined}
      // overflow: clip, not hidden: it rounds the corners without making a scroll box, so the sticky header follows #main.
      className={cn('min-w-0 overflow-clip rounded border bg-surface', className)}
    >
      <p aria-live="polite" aria-atomic="true" className="sr-only" data-table-count>
        {announced}
      </p>
      {toolbarNode || exportCsv ? (
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">{toolbarNode}</div>
          {loading ? <span className="text-xs text-fg-muted">{`Loading ${what}`}</span> : null}
          {densityOn ? (
            <SegmentedControl
              aria-label="Density"
              value={density}
              onValueChange={v => setDensity(v === 'compact' ? 'compact' : 'comfortable')}
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ]}
            />
          ) : null}
          {exportCsv ? (
            <Button variant="quiet" size="sm" icon={Download} onClick={csv} disabled={loading || !!error || dataRows.length === 0}>
              {exportCsv.label ?? 'Export CSV'}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        data-virtual={virtual ? '' : undefined}
        onScroll={virtual ? e => setScrollTop(e.currentTarget.scrollTop) : undefined}
        className={virtual ? 'overflow-auto' : fit.wide ? 'overflow-x-auto' : undefined}
        style={virtual ? { maxHeight } : undefined}
      >
        <table
          ref={tableRef}
          aria-label={label}
          aria-busy={loading || undefined}
          aria-rowcount={virtual ? items.length + 1 : undefined}
          role={cards ? 'table' : undefined}
          className={cn('w-full border-separate border-spacing-0 text-table', cards && 'block')}
        >
          <thead role={cards ? 'rowgroup' : undefined} className={cn(cards && 'sr-only')}>
            {columnBands && !cards ? (
              <tr className="hidden lg:table-row" data-testid="column-bands">
                {selection ? <th aria-hidden="true" className="h-[calc(var(--head-h)-8px)] border-b border-line bg-sunken" /> : null}
                {(() => {
                  const out: ReactNode[] = []
                  let i = 0
                  while (i < columns.length) {
                    const band = columnBands.find(b => b.from === columns[i].id)
                    if (band) {
                      const end = columns.findIndex(c => c.id === band.to)
                      const span = Math.max(1, (end < 0 ? i : end) - i + 1)
                      out.push(
                        <th key={`band-${band.from}`} colSpan={span} scope="colgroup" className="h-[calc(var(--head-h)-8px)] whitespace-nowrap border-b border-l border-line bg-sunken px-[var(--cell-px)] text-left text-xs font-medium text-fg-2">
                          {band.label}
                        </th>,
                      )
                      i += span
                    } else {
                      out.push(<td key={`gap-${columns[i].id}`} className="h-[calc(var(--head-h)-8px)] border-b border-line bg-sunken" />)
                      i += 1
                    }
                  }
                  return out
                })()}
              </tr>
            ) : null}
            <tr aria-rowindex={virtual ? 1 : undefined}>
              {selection ? (
                <th className="sticky top-0 z-[1] h-head w-10 border-b border-line bg-sunken px-[var(--cell-px)] first:pl-5 last:pr-5">
                  {checkbox(headState, () => setMany(ids, !allOn), 'Select all rows')}
                </th>
              ) : null}
              {columns.map(c => {
                const sortable = c.sortable ?? !!c.value
                const dir = sort?.id === c.id ? sort.dir : null
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : sortable ? 'none' : undefined}
                    style={c.width !== undefined ? { width: c.width } : undefined}
                    className={cn(
                      'group sticky top-0 z-[1] h-head whitespace-nowrap border-b border-line bg-sunken px-[var(--cell-px)] text-xs font-medium first:pl-5 last:pr-5',
                      alignRight(c) ? 'text-right' : 'text-left',
                      dir ? 'text-fg' : 'text-fg-2',
                      hide(c),
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => cycleSort(c.id)}
                        className="-mx-1 inline-flex h-6 items-center gap-1 rounded px-1 hover:bg-selected hover:text-fg"
                      >
                        {c.header}
                        <Icon
                          icon={dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ChevronsUpDown}
                          size="chip"
                          className={cn(!dir && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100')}
                        />
                      </button>
                    ) : c.hiddenHeader ? (
                      <span className="sr-only">{c.header}</span>
                    ) : (
                      c.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody ref={bodyRef} role={cards ? 'rowgroup' : undefined} className={cn(cards && 'block')}>
            {body}
          </tbody>
          {showFoot ? <tfoot>{summaryRow('foot', footerLabel ?? 'Total', dataRows, 'foot')}</tfoot> : null}
        </table>
      </div>

      {shown || hints || loading ? (
        <div className="flex min-h-10 items-center justify-between gap-3 border-t bg-surface px-4 py-2 text-xs text-fg-muted">
          {loading && !shown ? <Skeleton className="w-32" /> : <span>{shown}</span>}
          {hints ? (
            <span className="flex flex-wrap items-center justify-end gap-3 max-sm:hidden" aria-hidden="true">
              <span className="inline-flex items-center gap-[6px]"><Kbd>{'↑'}</Kbd><Kbd>{'↓'}</Kbd> move</span>
              {onRowOpen ? <span className="inline-flex items-center gap-[6px]"><Kbd>{'↵'}</Kbd> open</span> : null}
              {selection ? <span className="inline-flex items-center gap-[6px]"><Kbd>Space</Kbd> select</span> : null}
              {hasFilter ? <span className="inline-flex items-center gap-[6px]"><Kbd>/</Kbd> search</span> : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The row, two-line row and header heights the table draws (readRowMetrics: the density tokens, raised to the tallest row
 * in view), so the windowing maths matches the rows on screen. Read again when the density changes, when <html data-text>
 * changes (the text-size setting), when the pointer turns coarse or fine (a 2-in-1 folded into a tablet), and on request
 * (a new window of rows). Returns the metrics and that request.
 */
function useRowMetrics(rootRef: RefObject<HTMLDivElement>, density: Density, virtual: boolean): [RowMetrics, () => void] {
  const [m, setM] = useState<RowMetrics>(() => DEFAULT_ROW_METRICS[density])
  const read = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    // Only a windowed table needs the drawn rows; any other table just reads the tokens.
    const next = readRowMetrics(el, density, window, { rows: virtual })
    setM(prev => (prev.row === next.row && prev.tall === next.tall && prev.head === next.head ? prev : next))
  }, [rootRef, density, virtual])
  useLayoutEffect(() => {
    read()
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(read)
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-text'] })
    const pointer = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null
    pointer?.addEventListener?.('change', read)
    return () => {
      mo?.disconnect()
      pointer?.removeEventListener?.('change', read)
    }
  }, [read])
  return [m, read]
}
