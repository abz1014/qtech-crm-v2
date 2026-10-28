import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataTable, type Column } from '@/ui/DataTable'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/*
 * "The CRM crashes on the Companies page while scrolling." On a tablet-width window a long company name wraps to several
 * lines in a narrow column. The windowed table raises its row height to the tallest row in view and used to take the reading as
 * it came, so the height and the window of rows chased each other (tall rows in view -> tall height -> window moves to short
 * rows -> short height -> window moves back ...) until React threw "Maximum update depth exceeded" and the error screen came up.
 * jsdom has no layout, so the cell heights are stubbed: rows in the first third of the list are tall (4 lines), the rest short.
 */
interface Co {
  id: string
  name: string
}
const rows: Co[] = Array.from({ length: 300 }, (_, i) => ({ id: `c${i}`, name: `Company ${i}` }))
const columns: Column<Co>[] = [{ id: 'name', header: 'Company', value: r => r.name, cell: r => <div>{r.name}</div> }]

let host: HTMLDivElement | undefined
let root: ReturnType<typeof createRoot> | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  vi.restoreAllMocks()
})

function heightOf(el: Element): number {
  const tr = el.closest('tr[data-di]')
  if (!tr) return 0
  return Number(tr.getAttribute('data-di')) < 100 ? 200 : 20
}

describe('DataTable: row heights while scrolling', () => {
  it('settles instead of throwing "Maximum update depth exceeded" when tall and short rows alternate in view', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const h = this.matches('td > *') ? heightOf(this) : 0
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: h, width: 100, height: h, toJSON: () => ({}) } as DOMRect
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root!.render(<DataTable label="x" columns={columns} rows={rows} getRowId={r => r.id} twoLine defaultSort={{ id: 'name', dir: 'asc' }} />))
    const box = host.querySelector<HTMLElement>('[data-virtual]')!
    expect(box).not.toBeNull()
    const heights: number[] = []
    for (const top of [0, 3000, 0, 20000, 0, 6000, 30000, 0, 12000, 100, 15000, 0]) {
      box.scrollTop = top
      act(() => void box.dispatchEvent(new Event('scroll')))
      heights.push(Number.parseFloat(host.querySelector<HTMLElement>('tbody tr[data-di]')!.style.height))
    }
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/Maximum update depth/)
    // raise-only: once a tall row has been seen the height never drops back (that drop is what restarted the chase)
    for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeGreaterThanOrEqual(heights[i - 1])
  })
})
