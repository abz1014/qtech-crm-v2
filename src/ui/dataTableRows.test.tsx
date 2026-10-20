import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataTable, type Column } from '@/ui/DataTable'
import { DEFAULT_ROW_METRICS, readRowMetrics } from '@/ui/dataTableModel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/* DataTable's row heights for windowing (review #8): tokens from the computed style, raised to the tallest drawn row. */

/** A computed style that answers the given custom properties, and the cell padding DataTable draws (6 + 6 + a 1 px hairline). */
const styleOf = (vars: Record<string, string>) =>
  ({
    getComputedStyle: (el: Element) => {
      // A child marked data-neg sits in -12 px margins, like the selection checkbox's 44 px touch box.
      const neg = el instanceof HTMLElement && el.dataset.neg !== undefined
      return { getPropertyValue: (n: string) => vars[n] ?? '', paddingTop: '6px', paddingBottom: '6px', borderBottomWidth: '1px', marginTop: neg ? '-12px' : '0px', marginBottom: neg ? '-12px' : '0px' }
    },
  }) as unknown as Pick<Window, 'getComputedStyle'>

const rect = (h: number) => ({ height: h, width: 0, top: 0, left: 0, right: 0, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

/** A table root whose body rows each hold one cell with content of the given drawn height (a button, a line of text). */
function tableWith(contentHeights: number[], headHeight = 0, card?: number) {
  const root = document.createElement('div')
  root.innerHTML = `<table><thead><tr></tr></thead><tbody>${contentHeights.map((_, i) => `<tr data-di="${i}"><td><span></span></td></tr>`).join('')}${card ? '<tr data-di="99" data-card=""><td><span></span></td></tr>' : ''}</tbody></table>`
  root.querySelectorAll<HTMLElement>('tbody tr').forEach((tr, i) => {
    const h = tr.hasAttribute('data-card') ? (card ?? 0) : contentHeights[i]
    tr.querySelector<HTMLElement>('span')!.getBoundingClientRect = () => rect(h)
    tr.getBoundingClientRect = () => rect(999) // a pinned windowed row: never read
  })
  ;(root.querySelector('thead tr') as HTMLElement).getBoundingClientRect = () => rect(headHeight)
  return root
}

describe('readRowMetrics', () => {
  it('falls back to the normal-text tokens when nothing can be read (jsdom)', () => {
    expect(readRowMetrics(tableWith([]), 'comfortable')).toEqual(DEFAULT_ROW_METRICS.comfortable)
    expect(readRowMetrics(tableWith([]), 'compact')).toEqual(DEFAULT_ROW_METRICS.compact)
  })

  it('reads the density tokens from the computed style (Smaller text: 40 / 48 / 36)', () => {
    expect(readRowMetrics(tableWith([]), 'comfortable', styleOf({ '--row-h': '40px', '--row-h-tall': '48px', '--head-h': '36px' }))).toEqual({ row: 40, tall: 48, head: 36 })
  })

  it('a row with a 36 px small button needs 49 (36 + 12 padding + 1 hairline); text-only rows keep the token', () => {
    const m = readRowMetrics(tableWith([22, 36, 22], 40), 'comfortable', styleOf({ '--row-h': '48px', '--row-h-tall': '56px', '--head-h': '40px' }))
    expect(m).toEqual({ row: 49, tall: 56, head: 40 })
    expect(readRowMetrics(tableWith([22, 22]), 'comfortable', styleOf({ '--row-h': '48px' })).row).toBe(48)
  })

  it('a 40 px touch button needs 53, and a taller header is read too, rounded up to whole pixels', () => {
    expect(readRowMetrics(tableWith([39.4, 40], 41.5), 'comfortable', styleOf({ '--row-h': '48px' }))).toEqual({ row: 53, tall: 56, head: 42 })
  })

  it('the pinned row box is never read, so Smaller text can lower the height again', () => {
    expect(readRowMetrics(tableWith([20, 20]), 'comfortable', styleOf({ '--row-h': '40px', '--row-h-tall': '48px', '--head-h': '36px' })).row).toBe(40)
  })

  it('the selection checkbox box (42 px in -12 px margins) adds nothing beyond its 18 px', () => {
    const root = tableWith([42])
    root.querySelector<HTMLElement>('tbody span')!.dataset.neg = ''
    expect(readRowMetrics(root, 'comfortable', styleOf({ '--row-h': '48px' })).row).toBe(48)
  })

  it('phone cards are not windowed and are left out', () => {
    expect(readRowMetrics(tableWith([22], 0, 120), 'comfortable', styleOf({ '--row-h': '48px' })).row).toBe(48)
  })
})

describe('DataTable windowing follows the reading', () => {
  interface R { id: string; name: string }
  const big: R[] = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }))
  const columns: Column<R>[] = [{ id: 'name', header: 'Name', value: r => r.name }]
  let root: ReturnType<typeof createRoot> | undefined
  let el: HTMLElement | undefined
  afterEach(() => {
    act(() => root?.unmount())
    el?.remove()
    vi.restoreAllMocks()
    delete document.documentElement.dataset.text
  })

  const drawnRowHeight = () => (el!.querySelector<HTMLElement>('tbody tr[data-di]')!.style.height)

  it('re-reads when the text size changes and when the pointer type changes', async () => {
    let vars: Record<string, string> = { '--row-h': '48px', '--row-h-tall': '56px', '--head-h': '40px' }
    const real = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation(((node: Element) =>
      node instanceof HTMLElement && node.querySelector('table')
        ? ({ getPropertyValue: (n: string) => vars[n] ?? '' } as CSSStyleDeclaration)
        : real(node)) as typeof window.getComputedStyle)
    const listeners: Array<() => void> = []
    vi.spyOn(window, 'matchMedia').mockImplementation(
      query =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener: (_: string, l: () => void) => listeners.push(l),
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    )

    el = document.createElement('div')
    document.body.appendChild(el)
    root = createRoot(el)
    act(() => root!.render(<DataTable label="rows" columns={columns} rows={big} getRowId={r => r.id} />))
    expect(el.querySelector('[data-virtual]')).not.toBeNull()
    expect(drawnRowHeight()).toBe('48px')

    // The person picks Smaller: <html data-text="small"> changes and the tokens now read 40.
    vars = { '--row-h': '40px', '--row-h-tall': '48px', '--head-h': '36px' }
    await act(async () => {
      document.documentElement.dataset.text = 'small'
      await Promise.resolve()
    })
    expect(drawnRowHeight()).toBe('40px')

    // The laptop folds into a tablet: the pointer turns coarse and the rows are 48 again.
    vars = { '--row-h': '48px', '--row-h-tall': '48px', '--head-h': '36px' }
    act(() => listeners.forEach(l => l()))
    expect(drawnRowHeight()).toBe('48px')
  })
})
