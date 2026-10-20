import { describe, expect, it } from 'vitest'
import { buildResults, isPhone, mergeParts, renderMarkdown, score } from './report.lib.mjs'

/** A capture with sensible passing metrics; `over` patches the metrics. */
function cap(role, screen, viewport, over = {}, extra = {}) {
  const [w, h] = viewport.split('x').map(Number)
  const metrics = {
    url: `/${screen}`,
    title: screen,
    h1: screen,
    status: 'ok',
    viewport: { width: w, height: h },
    contentHeight: h * 2,
    actions: { total: 20, aboveFold: 10, buttons: 12, links: 8 },
    primary: { inMain: 1, inMainAboveFold: 1, disabledInMain: 0, inChrome: 1, labels: ['Save'] },
    chips: { total: 4, aboveFold: 2, header: 1, headerMethod: 'header element', headerLabels: ['Open'] },
    tables: { count: 1, maxColumns: 5, columns: [5] },
    words: { aboveFold: 120, total: 300 },
    text: { chars: 1000, under14: 50, from14to16: 800, atLeast16: 150, foldChars: 400, foldUnder14: 10, minPx: 13, sizes: { 13: 50, 15: 800, 16: 150 } },
    hScroll: { page: false, main: false, overflowPx: 0, offenders: [] },
    tap: w < 768 ? { checked: 10, minPx: 44, under44: 0, under24: 0, inlineLinks: 0, worst: [] } : null,
    nav: { levels: 1, labels: ['nav: Main'] },
    clipped: { count: 0, ellipsis: 0, samples: [] },
    ...over,
  }
  return { role, screen, visit: screen, title: `Title ${screen}`, viewport, status: 'ok', ms: 1, metrics, axe: { rules: 0, nodes: 0, byImpact: {}, byRule: {}, sample: [] }, shots: { fold: `shots/${role}/${screen}/${viewport}-fold.png` }, ...extra }
}

describe('screen audit report', () => {
  it('knows a phone viewport', () => {
    expect(isPhone('375x812')).toBe(true)
    expect(isPhone('1366x768')).toBe(false)
  })

  it('scores each target and leaves phone-only targets off desktop captures', () => {
    const ok = score(cap('admin', 'today', '1366x768'))
    expect(ok.primary).toEqual({ value: 1, pass: true })
    expect(ok.text14.pass).toBe(true) // 95%
    expect(ok.tap).toBeUndefined()
    const bad = score(
      cap('sales', 'rfq', '375x812', {
        primary: { inMain: 3, inMainAboveFold: 2, disabledInMain: 0, inChrome: 0, labels: ['A', 'B', 'C'] },
        text: { chars: 100, under14: 40, from14to16: 50, atLeast16: 10, foldChars: 0, foldUnder14: 0, minPx: 12, sizes: {} },
        hScroll: { page: false, main: true, overflowPx: 37.4, offenders: [] },
        tap: { checked: 5, minPx: 26, under44: 3, under24: 0, inlineLinks: 0, worst: [] },
      }),
    )
    expect(bad.primary.pass).toBe(false)
    expect(bad.text14).toEqual({ value: 60, pass: false })
    expect(bad.hScroll).toEqual({ value: 37, pass: false })
    expect(bad.tap).toEqual({ value: 3, pass: false })
  })

  it('merges parts, the newer capture of the same screen winning, in role then screen then viewport order', () => {
    const older = { meta: { ref: 'main', sha: 'abc1234', finishedAt: '2026-10-20T01:00:00Z', viewports: ['1366x768', '375x812'] }, captures: [cap('sales', 'today', '1366x768', { words: { aboveFold: 1, total: 1 } })] }
    const newer = {
      meta: { ref: 'main', sha: 'abc1234', finishedAt: '2026-10-20T02:00:00Z', viewports: ['1366x768', '375x812'] },
      captures: [cap('sales', 'today', '375x812'), cap('sales', 'today', '1366x768'), cap('admin', 'today', '1366x768')],
    }
    const m = mergeParts([newer, older])
    expect(m.captures.map(c => `${c.role} ${c.viewport}`)).toEqual(['admin 1366x768', 'sales 1366x768', 'sales 375x812'])
    expect(m.captures[1].metrics.words.total).toBe(300)
    expect(m.meta).toMatchObject({ ref: 'main', sha: 'abc1234', roles: ['admin', 'sales'], viewports: ['1366x768', '375x812'] })
  })

  it('renders the targets, the worst lists, bold misses and the captures it could not measure', () => {
    const parts = [
      {
        meta: { ref: 'main', sha: 'abc1234def', finishedAt: '2026-10-20T02:00:00Z', viewports: ['1366x768'] },
        captures: [
          cap('admin', 'today', '1366x768'),
          cap('admin', 'rfq-quoted', '1366x768', { chips: { total: 9, aboveFold: 9, header: 6, headerMethod: 'band under h1', headerLabels: ['Open', 'Due soon'] } }),
          { role: 'admin', screen: 'money-pnl', visit: 'money-pnl', title: 'P&L', viewport: '1366x768', status: 'error', error: 'timeout', ms: 0, shots: {} },
        ],
      },
    ]
    const r = buildResults(parts)
    expect(r.summary.byTarget.headerChips).toMatchObject({ applicable: 2, passed: 1 })
    expect(r.summary.worst.headerChips[0]).toMatchObject({ screen: 'rfq-quoted', value: 6 })
    const md = renderMarkdown(r)
    expect(md).toContain('# Screen audit: main at `abc1234`')
    expect(md).toContain('| Status chips in the page header | at most 2 | 50% (1/2) |')
    expect(md).toContain('| **6** |')
    expect(md).toContain('header chips (band under h1): "Open", "Due soon"')
    expect(md).toContain('admin `money-pnl` 1366x768: error: timeout')
    // every table row of a screen has the same number of cells as its header
    const rows = md.split('\n').filter(l => l.startsWith('| 1366x768'))
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row.match(/(?<!\\)\|/g)).toHaveLength(17)
  })
})
