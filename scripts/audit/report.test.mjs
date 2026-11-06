import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildResults, gateFailures, isPhone, mergeParts, renderMarkdown, score } from './report.lib.mjs'

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
    primary: { inMain: 1, inMainAboveFold: 1, disabledInMain: 0, inChrome: 1, labels: ['Save'], onScreen: 1, anywhere: 1, onScreenLabels: ['Save'] },
    chips: { total: 4, aboveFold: 2, header: 1, headerMethod: 'header element', headerLabels: ['Open'] },
    tables: { count: 1, maxColumns: 5, columns: [5] },
    words: { aboveFold: 120, total: 300 },
    text: { chars: 1000, under14: 50, from14to16: 800, atLeast16: 150, foldChars: 400, foldUnder14: 10, minPx: 13, sizes: { 13: 50, 15: 800, 16: 150 } },
    hScroll: { page: false, main: false, overflowPx: 0, offenders: [] },
    tap: w < 768 ? { checked: 10, minPx: 44, under44: 0, under24: 0, inlineLinks: 0, worst: [] } : null,
    nav: { levels: 1, labels: ['nav: Main'] },
    clipped: { count: 0, ellipsis: 0, samples: [] },
    overlap: { count: 0, checked: 200, samples: [] },
    overflow: { scrollers: 0, cut: 0, offscreen: 0, samples: [] },
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

  it('rubric-10 targets: 95% text, one green button on the whole screen, 8 actions in the page, no overlap, strips, low contrast or small inputs', () => {
    const s = score(
      cap('admin', 'rfq', '375x812', {
        actions: { total: 40, aboveFold: 20, buttons: 30, links: 10, mainAboveFold: 12 },
        text: { chars: 1000, under14: 60, from14to16: 800, atLeast16: 140, foldChars: 0, foldUnder14: 0, minPx: 12, sizes: {} },
        overlap: { count: 2, samples: ['"a" over "b"'] },
        strips: { count: 1, samples: ['strip: div "Any"'] },
        contrastHi: { checked: 30, failing: 3, samples: [] },
        inputs: { checked: 4, under16: 1, samples: [] },
      }),
    )
    expect(s.text14).toEqual({ value: 94, pass: false })
    expect(s.greenAll).toEqual({ value: 2, pass: false })
    expect(s.mainActionsFold).toEqual({ value: 12, pass: false })
    // no green is a pass only where the screen says it has no single next step; two or more never pass
    const none = (noPrimary, inMain) => score(cap('admin', 'todo', '1366x768', { noPrimary, primary: { inMain, inMainAboveFold: 0, disabledInMain: 0, inChrome: 0, labels: [] } })).greenAll
    expect(none(true, 0)).toEqual({ value: 0, pass: true })
    expect(none(false, 0)).toEqual({ value: 0, pass: false })
    expect(none(true, 2)).toEqual({ value: 2, pass: false })
    expect(s.overlap.pass).toBe(false)
    expect(s.strips.pass).toBe(false)
    expect(s.contrastHi.pass).toBe(false)
    expect(s.inputs16.pass).toBe(false)
    // desktop: the phone-only targets do not apply; a capture made before the new metrics existed leaves them out
    const old = score(cap('admin', 'rfq', '1366x768', { primary: { inMain: 1, inMainAboveFold: 1, disabledInMain: 0, inChrome: 0, labels: [] }, overlap: undefined, overflow: undefined }))
    expect(old.greenAll).toEqual({ value: 1, pass: true })
    expect(old.mainActionsFold).toBeUndefined()
    expect(old.overlap).toBeUndefined()
    expect(old.strips).toBeUndefined()
    expect(old.inputs16).toBeUndefined()
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
          cap('admin', 'job-quoted', '1366x768', { chips: { total: 9, aboveFold: 9, header: 6, headerMethod: 'band under h1', headerLabels: ['Open', 'Due soon'] } }),
          { role: 'admin', screen: 'money-pnl', visit: 'money-pnl', title: 'P&L', viewport: '1366x768', status: 'error', error: 'timeout', ms: 0, shots: {} },
        ],
      },
    ]
    const r = buildResults(parts)
    expect(r.summary.byTarget.headerChips).toMatchObject({ applicable: 2, passed: 1 })
    expect(r.summary.worst.headerChips[0]).toMatchObject({ screen: 'job-quoted', value: 6 })
    const md = renderMarkdown(r)
    expect(md).toContain('# Screen audit: main at `abc1234`')
    expect(md).toContain('| Status chips in the page header | at most 2 | 50% (1/2) |')
    expect(md).toContain('| **6** |')
    expect(md).toContain('header chips (band under h1): "Open", "Due soon"')
    expect(md).toContain('admin `money-pnl` 1366x768: error: timeout')
    // every table row of a screen has the same number of cells as its header
    const rows = md.split('\n').filter(l => l.startsWith('| 1366x768'))
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row.match(/(?<!\\)\|/g)).toHaveLength(20)
  })

  it('counts green buttons in the bars, overlapping text and cut text, and tolerates parts without them', () => {
    const two = cap('sales', 'rfqs-open', '1366x768', {
      primary: { inMain: 1, inMainAboveFold: 1, disabledInMain: 0, inChrome: 1, labels: ['New RFQ'], onScreen: 2, anywhere: 2, onScreenLabels: ['New RFQ', 'Paste or photo [bar]'] },
      overlap: { count: 2, checked: 300, samples: ['"flow meter" x "RFQ-0008" (12x18px)'] },
      overflow: {
        scrollers: 1,
        cut: 1,
        offscreen: 1,
        samples: [
          { kind: 'cut', what: '"waiting or" in span' },
          { kind: 'offscreen', what: 'input "Search" right=402' },
          { kind: 'scroller', what: 'div.flex +40px' },
        ],
      },
    })
    const s = score(two)
    expect(s.green).toEqual({ value: 2, pass: false })
    expect(s.overlap).toEqual({ value: 2, pass: false })
    expect(s.cut).toEqual({ value: 2, pass: false })
    const none = cap('admin', 'settings', '1366x768', { primary: { inMain: 0, inMainAboveFold: 0, disabledInMain: 0, inChrome: 0, labels: [], onScreen: 0, anywhere: 0, onScreenLabels: [] } })
    expect(score(none).green.pass).toBe(true)
    // a part written before these metrics existed
    const old = cap('admin', 'today', '1366x768', { primary: { inMain: 1, inMainAboveFold: 1, disabledInMain: 0, inChrome: 1, labels: ['Save'] }, overlap: undefined, overflow: undefined })
    expect(score(old).green).toBeUndefined()
    expect(score(old).overlap).toBeUndefined()
    expect(score(old).cut).toBeUndefined()
    const md = renderMarkdown(buildResults([{ meta: { finishedAt: '2026-10-22T00:00:00Z', viewports: ['1366x768'] }, captures: [two, none, old] }]))
    expect(md).toContain('green on screen: "New RFQ", "Paste or photo [bar]"')
    expect(md).toContain('text over text: "flow meter" x "RFQ-0008" (12x18px)')
    expect(md).toContain('cut off: "waiting or" in span')
    expect(md).toContain('past right edge: input "Search" right=402')
    expect(md).toContain('scrolls sideways: div.flex +40px')
    expect(md).toContain('info: no green button on screen')
    const rows = md.split('\n').filter(l => l.startsWith('| 1366x768'))
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row.match(/(?<!\\)\|/g)).toHaveLength(20)
  })

  describe('layout gate', () => {
    const clean = { docScroll: { count: 0, docOverPx: 0, scrolledPx: 0, shellGapPx: 0, samples: [] }, nestedScroll: { count: 0, samples: [] }, boxOverflow: { count: 0, samples: [] }, labelTouchesControl: { count: 0, samples: [] }, unevenWrap: { count: 0, samples: [] } }
    const withLayout = (role, screen, vp, layout, over = {}) => cap(role, screen, vp, { layout: { ...clean, ...layout }, ...over })

    it('passes a clean capture and an old one that has no layout numbers', () => {
      const old = cap('admin', 'today', '1440x900')
      expect(gateFailures([withLayout('admin', 'today', '1440x900', {}), old])).toEqual([])
      expect(score(old).docScroll).toBeUndefined()
    })

    it('fails on a page scroll (bug B) and on text hanging out of a box (bug A), naming where', () => {
      const a = withLayout('admin', 'money-expenses-add', '1440x900', { boxOverflow: { count: 1, samples: ['"Amount, PKR" hangs 8px below div (box 36px, content 44px)'] } })
      const b = withLayout('admin', 'money-expenses', '1440x900', { docScroll: { count: 2, docOverPx: 24, scrolledPx: 24, shellGapPx: 0, samples: ['window scrolls 24px'] } })
      const f = gateFailures([a, b])
      expect(f.map(x => `${x.key} ${x.screen}`)).toEqual(['boxOverflow money-expenses-add', 'docScroll money-expenses'])
      expect(f[0].detail).toContain('hangs 8px')
      expect(f[1]).toMatchObject({ role: 'admin', viewport: '1440x900', value: 2 })
    })

    it('fails on a second scrollbar, text on a control and a sideways scroll; the uneven-wrap hint and the older targets never gate', () => {
      const c = withLayout('admin', 'x', '1024x768', {
        nestedScroll: { count: 1, samples: ['div "a" scrolls 40px inside the page'] },
        labelTouchesControl: { count: 3, samples: ['"Date" over input'] },
        unevenWrap: { count: 5, samples: [] },
      }, { hScroll: { page: true, main: false, overflowPx: 12, offenders: ['div right=1100'] }, primary: { inMain: 3, inMainAboveFold: 3, disabledInMain: 0, inChrome: 0, labels: [] }, actions: { total: 40, aboveFold: 20, buttons: 30, links: 10, mainAboveFold: 12 } })
      expect(gateFailures([c]).map(x => x.key).sort()).toEqual(['hScroll', 'labelTouchesControl', 'nestedScroll'])
      expect(score(c).unevenWrap).toEqual({ value: 5, pass: false })
      expect(score(c).mainActionsFold.pass).toBe(false) // advisory, and not in the gate
    })

    it('lists the findings in the report and the results', () => {
      const r = buildResults([{ meta: { finishedAt: '2026-11-06T00:00:00Z', viewports: ['1440x900'] }, captures: [withLayout('admin', 'a', '1440x900', { docScroll: { count: 1, docOverPx: 9, scrolledPx: 0, shellGapPx: 0, samples: ['document is 9px taller than the window'] } })] }])
      expect(r.gate.layout.failed).toBe(1)
      const md = renderMarkdown(r)
      expect(md).toContain('**FAILED: 1 finding(s).**')
      expect(md).toContain('page scrolls: document is 9px taller than the window')
    })

    it('report.mjs --gate layout exits 1 on a failing run, 0 on a clean one, 1 with no layout data', () => {
      const script = resolve('scripts/audit/report.mjs')
      const run = (captures, extra = ['--gate', 'layout']) => {
        const dir = mkdtempSync(join(tmpdir(), 'gate-'))
        mkdirSync(join(dir, 'parts'))
        writeFileSync(join(dir, 'parts', 'p.json'), JSON.stringify({ meta: { finishedAt: '2026-11-06T00:00:00Z', viewports: ['1440x900'] }, captures }))
        return spawnSync(process.execPath, [script, dir, ...extra], { encoding: 'utf8' })
      }
      const bad = run([withLayout('admin', 'money-expenses', '1440x900', { docScroll: { count: 1, docOverPx: 9, scrolledPx: 0, shellGapPx: 0, samples: ['x'] } })])
      expect(bad.status).toBe(1)
      expect(bad.stderr).toContain('Layout gate FAILED')
      expect(run([withLayout('admin', 'today', '1440x900', {})]).status).toBe(0)
      expect(run([cap('admin', 'today', '1440x900')]).status).toBe(1)
      // without --gate the report never fails on a finding
      expect(run([withLayout('admin', 'money-expenses', '1440x900', { boxOverflow: { count: 2, samples: [] } })], []).status).toBe(0)
    })
  })
})
