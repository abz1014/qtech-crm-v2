import { useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { Kbd } from '@/ui/Kbd'
import { Checkbox } from '@/ui/form/Checkbox'
import { Money } from '@/ui/Money'
import { Skeleton } from '@/ui/Skeleton'
import { downloadCSV, generateCSV } from '@/lib/csvExport'
import { paisaToFixed } from '@/lib/money'
import {
  columnShowsPaisa,
  columnTotal,
  sortRows,
  tableCsvRows,
  type Column,
  type SortState,
} from '@/ui/dataTableModel'

export type { Column, SortState } from '@/ui/dataTableModel'

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
 * heights are fixed (40 / 32 / 48 and 36 for group rows) so no measuring is needed.
 *
 * Keyboard: Up/Down or J/K move the focus row, Home/End jump, PageUp/PageDown move
 * 10, Enter opens, Space ticks. Focus is a roving tabindex: one Tab stop for the body.
 */
const GROUP_H = 36
const HEAD_H = 36
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
  density?: 'comfortable' | 'compact'
  /** Controlled sort. Omit to let the table hold it (starting from `defaultSort`). */
  sort?: SortState | null
  defaultSort?: SortState | null
  onSortChange?: (sort: SortState | null) => void
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
  /** Totals footer label ("All 9 invoices shown"). The footer shows when any column has `total`. */
  footerLabel?: ReactNode
  /** Left of the bottom bar: "Showing 7 of 7 RFQs". */
  summary?: ReactNode
  /** Filters and actions above the table. A function receives the ticked count (batch bar). */
  toolbar?: ReactNode | ((ctx: { selectedCount: number }) => ReactNode)
  exportCsv?: { filename: string; label?: string }
  loading?: boolean
  error?: { title: string; message?: ReactNode; onRetry?: () => void; reference?: string } | null
  /** The empty-state slot. Say what is true and what happens next ("Every bid is in"). */
  empty?: ReactNode
  /** Scroll height once virtualised. Default 70vh. */
  maxHeight?: string
  virtualAfter?: number
  /** Rows hold two-line cells (name over reference): 48 px as in the mockups. Required for virtualised tables with two-line cells. */
  twoLine?: boolean
  className?: string
}

export function DataTable<T>(props: DataTableProps<T>) {
  const {
    columns,
    rows,
    getRowId,
    label,
    density = 'comfortable',
    selection,
    activeRowId,
    onRowOpen,
    group,
    footerLabel,
    summary,
    toolbar,
    exportCsv,
    loading,
    error,
    empty,
    maxHeight = '70vh',
    virtualAfter = 80,
    twoLine,
    className,
  } = props

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
  const coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches
  const rowH = coarse || twoLine ? 48 : density === 'compact' ? 32 : 40
  const virtual = items.length > virtualAfter
  const offsets = useMemo(() => {
    const o = new Array<number>(items.length + 1)
    o[0] = 0
    for (let i = 0; i < items.length; i++) o[i + 1] = o[i] + (items[i].t === 'group' ? GROUP_H : rowH)
    return o
  }, [items, rowH])

  const scrollRef = useRef<HTMLDivElement>(null)
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
    const y0 = Math.max(0, scrollTop - HEAD_H)
    return [Math.max(0, find(y0) - OVERSCAN), Math.min(items.length, find(y0 + viewH) + 1 + OVERSCAN)]
  }, [virtual, items.length, offsets, scrollTop, viewH])

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
      const top = HEAD_H + offsets[flat]
      const bottom = HEAD_H + offsets[flat + 1]
      let target = el.scrollTop
      if (top < target + HEAD_H) target = top - HEAD_H
      else if (bottom > target + viewH) target = bottom - viewH
      if (target !== el.scrollTop) {
        el.scrollTop = target
        setScrollTop(target)
      }
    }
  }

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
          onRowOpen(row)
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
  const hide = (c: Column<T>) => (c.hideBelowMd ? 'hidden md:table-cell' : '')

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
  const summaryRow = (kind: 'group' | 'foot', labelNode: ReactNode, list: readonly T[], key: string, groupIds?: string[]) => (
    <tr
      key={key}
      data-row-kind={kind}
      style={kind === 'group' && virtual ? { height: GROUP_H } : undefined}
      className={cn(kind === 'group' ? 'bg-canvas text-xs font-medium text-fg-muted [&_.num]:text-fg-2' : 'bg-sunken font-medium')}
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
        className={cn('h-9 whitespace-nowrap border-b border-line px-[var(--cell-px)] first:pl-5 last:pr-5', kind === 'foot' && 'border-t border-line-strong')}
      >
        {labelNode}
      </td>
      {columns.slice(labelCols).map(c => (
        <td
          key={c.id}
          className={cn(
            'h-9 whitespace-nowrap border-b border-line px-[var(--cell-px)] first:pl-5 last:pr-5',
            kind === 'foot' && 'border-t border-line-strong',
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
          if (onRowOpen && !(e.target as HTMLElement).closest('a,button,input,label,select,textarea')) onRowOpen(row)
        }}
        className={cn(
          'transition-colors focus-visible:bg-sunken focus-visible:-outline-offset-2',
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
            {renderCell(c, row)}
          </td>
        ))}
      </tr>
    )
  }

  const body: ReactNode = (() => {
    if (error)
      return (
        <tr>
          <td colSpan={colCount}>
            <EmptyState
              mood="error"
              title={error.title}
              actions={error.onRetry ? <Button variant="primary" icon={RefreshCw} onClick={error.onRetry}>Try again</Button> : undefined}
              meta={error.reference ? `Reference ${error.reference}` : undefined}
            >
              {error.message}
            </EmptyState>
          </td>
        </tr>
      )
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
          <td colSpan={colCount}>{empty}</td>
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

  const showFoot = hasTotals && !loading && !error && items.length > 0
  const hints = !!(onRowOpen || selection)

  return (
    <div
      data-density={density === 'compact' ? 'compact' : undefined}
      className={cn('overflow-hidden rounded border bg-surface', className)}
    >
      {toolbarNode || exportCsv ? (
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">{toolbarNode}</div>
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
        className="overflow-auto"
        style={virtual ? { maxHeight } : undefined}
      >
        <table
          aria-label={label}
          aria-busy={loading || undefined}
          aria-rowcount={virtual ? items.length + 1 : undefined}
          className="w-full border-separate border-spacing-0 text-table"
        >
          <thead>
            <tr aria-rowindex={virtual ? 1 : undefined}>
              {selection ? (
                <th className="sticky top-0 z-[1] h-[36px] w-10 border-b border-line bg-sunken px-[var(--cell-px)] first:pl-5 last:pr-5">
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
                      'group sticky top-0 z-[1] h-[36px] whitespace-nowrap border-b border-line bg-sunken px-[var(--cell-px)] text-xs font-medium first:pl-5 last:pr-5',
                      alignRight(c) ? 'text-right' : 'text-left',
                      dir ? 'text-fg' : 'text-fg-muted',
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
                    ) : (
                      c.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody ref={bodyRef}>{body}</tbody>
          {showFoot ? <tfoot>{summaryRow('foot', footerLabel ?? 'Total', dataRows, 'foot')}</tfoot> : null}
        </table>
      </div>

      {summary || hints ? (
        <div className="flex items-center justify-between gap-3 border-t bg-surface px-4 py-2 text-xs text-fg-muted">
          <span>{summary}</span>
          {hints ? (
            <span className="hidden items-center gap-3 md:flex" aria-hidden="true">
              <span className="inline-flex items-center gap-1"><Kbd>{'↑'}</Kbd><Kbd>{'↓'}</Kbd> move</span>
              {onRowOpen ? <span className="inline-flex items-center gap-1"><Kbd>{'↵'}</Kbd> open</span> : null}
              {selection ? <span className="inline-flex items-center gap-1"><Kbd>Space</Kbd> select</span> : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
