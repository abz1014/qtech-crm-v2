import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataTable, type Column } from '@/ui/DataTable'
import { generateCSV } from '@/lib/csvExport'
import { paisaToFixed, sumPaisa } from '@/lib/money'
import { tableCsvRows } from '@/ui/dataTableModel'
import { StatusBadge } from '@/ui/StatusBadge'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface Inv {
  id: string
  no: string
  month: string
  customer: string
  net: string
  gst: string
  gross: string
  fbr: string
}

const INVOICES: Inv[] = [
  { id: 'a', no: 'INV-2260', month: 'November 2026', customer: 'Punjab Cement', net: '860000.10', gst: '154800.02', gross: '1014800.12', fbr: 'pending' },
  { id: 'b', no: 'INV-2259', month: 'November 2026', customer: 'Indus Textile', net: '312500', gst: '56250', gross: '368750', fbr: 'generated' },
  { id: 'c', no: 'INV-2250', month: 'October 2026', customer: 'Sargodha Dairy', net: '745000.45', gst: '134100.08', gross: '879100.53', fbr: 'deposited' },
]

const columns: Column<Inv>[] = [
  { id: 'no', header: 'Invoice', value: r => r.no },
  { id: 'customer', header: 'Customer', value: r => r.customer },
  { id: 'net', header: 'Net (PKR)', kind: 'money', value: r => r.net, total: true },
  { id: 'gst', header: 'GST (PKR)', kind: 'money', value: r => r.gst, total: true },
  { id: 'gross', header: 'Gross (PKR)', kind: 'money', value: r => r.gross, total: true },
  { id: 'fbr', header: 'FBR', cell: r => <StatusBadge dimension="fbr" value={r.fbr} /> },
]

let root: ReturnType<typeof createRoot> | undefined
let el: HTMLElement
function mount(node: React.ReactElement) {
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root!.render(node))
}
afterEach(() => {
  act(() => root?.unmount())
  el?.remove()
  root = undefined
})

const key = (target: Element, k: string, init: KeyboardEventInit = {}) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }))
  })
const rows = () => [...el.querySelectorAll<HTMLElement>('tbody tr[data-di]')]
const cellTexts = (tr: Element) => [...tr.querySelectorAll('td')].map(td => td.textContent?.trim())

describe('DataTable: totals and groups', () => {
  it('the footer and each group subtotal equal the exact sum of their rows', () => {
    mount(<DataTable label="GST register" columns={columns} rows={INVOICES} getRowId={r => r.id} group={r => ({ key: r.month, label: r.month })} footerLabel="All 3 invoices shown" />)
    const groups = [...el.querySelectorAll('tr[data-row-kind="group"]')].map(cellTexts)
    expect(groups[0]).toEqual(['November 2026', '1,172,500.10', '211,050.02', '1,383,550.12', ''])
    expect(groups[1]).toEqual(['October 2026', '745,000.45', '134,100.08', '879,100.53', ''])
    const foot = cellTexts(el.querySelector('tfoot tr')!)
    const net = paisaToFixed(sumPaisa(INVOICES.map(i => i.net)))
    expect(net).toBe('1917500.55')
    expect(foot).toEqual(['All 3 invoices shown', '1,917,500.55', '345,150.10', '2,262,650.65', ''])
  })

  it('shows two decimals on every row of a money column when any row has paisa, so digits align', () => {
    mount(<DataTable label="x" columns={columns} rows={INVOICES} getRowId={r => r.id} />)
    expect(cellTexts(rows()[1])[2]).toBe('312,500.00')
  })

  it('keeps whole figures whole when no row has paisa', () => {
    const whole = INVOICES.map(r => ({ ...r, net: '1000' }))
    mount(<DataTable label="x" columns={columns} rows={whole} getRowId={r => r.id} />)
    expect(cellTexts(rows()[0])[2]).toBe('1,000')
  })
})

describe('DataTable: sorting', () => {
  it('cycles ascending, descending, unsorted and sets aria-sort', () => {
    mount(<DataTable label="x" columns={columns} rows={INVOICES} getRowId={r => r.id} />)
    const th = () => el.querySelector('th[scope="col"]:nth-child(3)')!
    const click = () => act(() => (th().querySelector('button') as HTMLButtonElement).click())
    click()
    expect(th().getAttribute('aria-sort')).toBe('ascending')
    expect(rows().map(r => r.querySelector('td')!.textContent)).toEqual(['INV-2259', 'INV-2250', 'INV-2260'])
    click()
    expect(th().getAttribute('aria-sort')).toBe('descending')
    expect(rows().map(r => r.querySelector('td')!.textContent)).toEqual(['INV-2260', 'INV-2250', 'INV-2259'])
    click()
    expect(th().getAttribute('aria-sort')).toBe('none')
    expect(rows().map(r => r.querySelector('td')!.textContent)).toEqual(['INV-2260', 'INV-2259', 'INV-2250'])
  })

  it('sorts money by exact value, not by text', () => {
    const r = [
      { ...INVOICES[0], id: 'x', net: '9' },
      { ...INVOICES[0], id: 'y', net: '10' },
      { ...INVOICES[0], id: 'z', net: '1000000000000.01' },
    ]
    mount(<DataTable label="x" columns={columns} rows={r} getRowId={x => x.id} defaultSort={{ id: 'net', dir: 'desc' }} />)
    expect(rows().map(tr => tr.getAttribute('data-di'))).toEqual(['0', '1', '2'])
    expect(cellTexts(rows()[0])[2]).toBe('1,000,000,000,000.01')
  })

  it('keeps missing values last whichever way it sorts', () => {
    const r = [{ ...INVOICES[0], id: 'n', net: '' }, { ...INVOICES[1], id: 'm' }]
    const cols = columns.map(c => (c.id === 'net' ? { ...c, value: (x: Inv) => x.net || null } : c))
    mount(<DataTable label="x" columns={cols} rows={r} getRowId={x => x.id} defaultSort={{ id: 'net', dir: 'desc' }} />)
    expect(rows()[1].querySelector('td')!.textContent).toBe('INV-2260')
  })
})

describe('DataTable: keyboard', () => {
  it('moves with arrows and j/k, opens with Enter, one tab stop', () => {
    const open = vi.fn()
    mount(<DataTable label="x" columns={columns} rows={INVOICES} getRowId={r => r.id} onRowOpen={open} />)
    expect(rows().map(r => r.tabIndex)).toEqual([0, -1, -1])
    key(rows()[0], 'ArrowDown')
    expect(document.activeElement).toBe(rows()[1])
    expect(rows().map(r => r.tabIndex)).toEqual([-1, 0, -1])
    key(rows()[1], 'j')
    expect(document.activeElement).toBe(rows()[2])
    key(rows()[2], 'ArrowDown') // clamps at the end
    expect(document.activeElement).toBe(rows()[2])
    key(rows()[2], 'k')
    expect(document.activeElement).toBe(rows()[1])
    key(rows()[1], 'Home')
    expect(document.activeElement).toBe(rows()[0])
    key(rows()[0], 'Enter')
    expect(open).toHaveBeenCalledWith(INVOICES[0])
  })

  it('Space ticks the focus row and Shift-click ticks a range', () => {
    function Harness() {
      const [sel, setSel] = useState<ReadonlySet<string>>(new Set())
      return (
        <>
          <output>{[...sel].sort().join(',')}</output>
          <DataTable label="x" columns={columns} rows={INVOICES} getRowId={r => r.id} selection={{ selected: sel, onChange: setSel }} />
        </>
      )
    }
    mount(<Harness />)
    const out = () => el.querySelector('output')!.textContent
    key(rows()[0], ' ')
    expect(out()).toBe('a')
    const boxes = () => [...el.querySelectorAll<HTMLButtonElement>('tbody button[role="checkbox"]')]
    act(() => boxes()[2].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
    expect(out()).toBe('a,b,c')
    // header checkbox: everything is on, so one click clears it
    act(() => el.querySelector<HTMLButtonElement>('thead button[role="checkbox"]')!.click())
    expect(out()).toBe('')
  })

  it('a group checkbox ticks the whole group', () => {
    function Harness() {
      const [sel, setSel] = useState<ReadonlySet<string>>(new Set())
      return (
        <>
          <output>{[...sel].sort().join(',')}</output>
          <DataTable
            label="x"
            columns={columns}
            rows={INVOICES}
            getRowId={r => r.id}
            group={r => ({ key: r.month, label: r.month })}
            selection={{ selected: sel, onChange: setSel }}
          />
        </>
      )
    }
    mount(<Harness />)
    act(() => el.querySelector<HTMLButtonElement>('tr[data-row-kind="group"] button[role="checkbox"]')!.click())
    expect(el.querySelector('output')!.textContent).toBe('a,b')
  })
})

describe('DataTable: states', () => {
  it('shows the empty-state slot and keeps the header', () => {
    mount(<DataTable label="x" columns={columns} rows={[]} getRowId={r => r.id} empty={<p>Every bid is in</p>} />)
    expect(el.textContent).toContain('Every bid is in')
    expect(el.querySelector('thead')).not.toBeNull()
    expect(el.querySelector('tfoot')).toBeNull()
  })

  it('loading draws skeleton rows with a real header; error offers a retry', () => {
    mount(<DataTable label="x" columns={columns} rows={[]} getRowId={r => r.id} loading />)
    expect(el.querySelectorAll('tbody tr').length).toBe(6)
    expect(el.querySelector('table')!.getAttribute('aria-busy')).toBe('true')
    const retry = vi.fn()
    act(() => root!.render(<DataTable label="x" columns={columns} rows={[]} getRowId={r => r.id} error={{ title: 'Couldn’t load invoices', onRetry: retry, reference: '4f1c9a' }} />))
    expect(el.textContent).toContain('4f1c9a')
    act(() => [...el.querySelectorAll('button')].find(b => b.textContent === 'Try again')!.click())
    expect(retry).toHaveBeenCalled()
  })
})

describe('DataTable: 1,000 rows', () => {
  const big: Inv[] = Array.from({ length: 1000 }, (_, i) => ({
    id: `r${i}`,
    no: `INV-${String(i).padStart(4, '0')}`,
    month: `Month ${i % 12}`,
    customer: `Customer ${i}`,
    net: String(1000 + i),
    gst: String(180 + i),
    gross: String(1180 + 2 * i),
    fbr: ['pending', 'generated', 'receipt_received', 'deposited'][i % 4],
  }))

  it('renders in under 100 ms by drawing only the rows in view', () => {
    const t0 = performance.now()
    mount(<DataTable label="big" columns={columns} rows={big} getRowId={r => r.id} selection={{ selected: new Set(), onChange: () => undefined }} />)
    const ms = performance.now() - t0
    expect(el.querySelector('[data-virtual]')).not.toBeNull()
    expect(rows().length).toBeLessThan(60)
    expect(ms).toBeLessThan(100)
  })

  it('footer total still covers all 1,000 rows, not just the visible ones', () => {
    mount(<DataTable label="big" columns={columns} rows={big} getRowId={r => r.id} />)
    const expected = paisaToFixed(sumPaisa(big.map(r => r.net)))
    expect(cellTexts(el.querySelector('tfoot tr')!)[1]).toBe(Number(expected).toLocaleString('en-US'))
  })

  it('keyboard End reaches the last row even though it was not rendered', () => {
    mount(<DataTable label="big" columns={columns} rows={big} getRowId={r => r.id} />)
    key(rows()[0], 'End')
    expect(document.activeElement?.getAttribute('data-di')).toBe('999')
  })
})

describe('DataTable: CSV (U04)', () => {
  it('neutralises formula injection in every text cell', () => {
    const evil: Inv[] = [{ ...INVOICES[0], customer: '=HYPERLINK("http://x","y")', no: '+1+1', fbr: '@SUM(A1)' }]
    const cols: Column<Inv>[] = [
      { id: 'no', header: 'Invoice', value: r => r.no },
      { id: 'customer', header: 'Customer', value: r => r.customer },
      { id: 'fbr', header: 'FBR', value: r => r.fbr },
    ]
    const { headers, rows: body } = tableCsvRows(cols, evil)
    const csv = generateCSV(headers, body)
    expect(csv).toContain(`"'+1+1"`)
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")"`)
    expect(csv).toContain(`"'@SUM(A1)"`)
  })

  it('exports money as a number to the paisa (negatives stay numeric) and appends a Total row that equals the sum', () => {
    const r = [{ ...INVOICES[0], net: '-84500.50' }, { ...INVOICES[1], net: '1000.25' }]
    const { rows: body } = tableCsvRows(columns, r)
    expect(body[0][2]).toBe(-84500.5)
    expect(body.at(-1)![0]).toBe('Total')
    expect(body.at(-1)![2]).toBe(-83500.25)
    expect(generateCSV(['n'], [[-84500.5]])).toBe('"n"\n"-84500.5"')
  })
})
