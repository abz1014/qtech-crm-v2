/*
 * Screen audit report (docs/audit/SCREEN_AUDIT.md): merges the per-role result parts written by e2e/audit/screens.audit.ts, scores
 * every capture against the UX audit's targets (docs/audit/ux-2026-10-19/ and the owner decisions in docs/DECISIONS.md, 2026-10-19)
 * and renders audit-results.json and audit-report.md. Pure functions; the CLI is report.mjs.
 */

const ROLE_ORDER = ['admin', 'sales', 'engineer']
export const PHONE_MAX_WIDTH = 767

const width = vp => Number(String(vp).split('x')[0])
export const isPhone = vp => width(vp) <= PHONE_MAX_WIDTH
const pct = (part, whole) => (whole > 0 ? (100 * part) / whole : null)

/**
 * The targets. `value` reads a capture's number (null when it does not apply), `pass` says whether it meets the target,
 * `worse` says which direction is worse (for the worst-5 lists).
 */
export const TARGETS = [
  {
    key: 'primary',
    label: 'Primary buttons in the page',
    target: 'at most 1',
    source: 'step 2: one primary button per screen, chosen by state',
    value: c => c.metrics.primary.inMain,
    pass: v => v <= 1,
    worse: 'higher',
  },
  {
    key: 'green',
    label: 'Green buttons on screen (page and bars)',
    target: 'at most 1',
    source: 'rubric: exactly one green main button; counts the top bar and phone bars too (0 is listed, not failed)',
    value: c => c.metrics.primary.onScreen ?? null,
    pass: v => v <= 1,
    worse: 'higher',
  },
  {
    key: 'headerChips',
    label: 'Status chips in the page header',
    target: 'at most 2',
    source: 'step 2: RFQ header chips 6 to 2',
    value: c => c.metrics.chips.header,
    pass: v => v <= 2,
    worse: 'higher',
  },
  {
    key: 'text14',
    label: 'Characters at 14 px or larger',
    target: 'at least 95%',
    source: 'rubric-10 "Text size": at least 95% of visible text 14 px or larger',
    value: c => {
      const t = c.metrics.text
      return t.chars ? pct(t.from14to16 + t.atLeast16, t.chars) : null
    },
    pass: v => v >= 95,
    worse: 'lower',
    format: v => `${Math.round(v)}%`,
  },
  {
    key: 'hScroll',
    label: 'Page scrolls sideways (px)',
    target: 'none',
    source: 'no-sideways-scroll checks in the E2E suites',
    value: c => (c.metrics.hScroll.page || c.metrics.hScroll.main ? Math.max(1, Math.round(c.metrics.hScroll.overflowPx)) : 0),
    pass: v => v === 0,
    worse: 'higher',
    format: v => (v === 0 ? 'no' : `${v}px`),
    gate: true,
  },
  {
    key: 'axe',
    label: 'axe violations (failing nodes)',
    target: '0',
    source: 'WCAG 2.2 AA plus best practice, as every E2E suite runs it',
    value: c => (c.axe ? c.axe.nodes : null),
    pass: v => v === 0,
    worse: 'higher',
  },
  {
    key: 'tap',
    label: 'Phone tap targets under 44 px',
    target: '0',
    source: 'DESIGN_SYSTEM: 44 px on phones (--hit-touch)',
    value: c => (isPhone(c.viewport) && c.metrics.tap ? c.metrics.tap.under44 : null),
    pass: v => v === 0,
    worse: 'higher',
  },
  {
    key: 'nav',
    label: 'Navigation strips stacked above the fold',
    target: 'at most 2',
    source: 'step 3: Money flattened to 2 levels',
    value: c => c.metrics.nav.levels,
    pass: v => v <= 2,
    worse: 'higher',
  },
  {
    key: 'clipped',
    label: 'Elements with clipped text',
    target: '0',
    source: 'bigger text must not cut words off',
    value: c => c.metrics.clipped.count,
    pass: v => v === 0,
    worse: 'higher',
  },
  // Rubric-10 targets (2026-10-22). A capture made before a metric existed has no value for it and is left out of that row.
  {
    key: 'greenAll',
    label: 'Green buttons on the whole screen (page + top bar)',
    target: 'exactly 1 (0 where the screen has data-no-primary)',
    source: 'rubric-10 "What stands out first": exactly one green main button on every screen; a screen with no single next step marks itself data-no-primary and may have none; two or more always fails',
    value: c => c.metrics.primary.inMain + c.metrics.primary.inChrome,
    pass: (v, c) => v === 1 || (v === 0 && c?.metrics?.noPrimary === true),
    worse: 'higher',
  },
  {
    key: 'mainActionsFold',
    label: 'Buttons and links above the fold in the page (main)',
    target: 'at most 8',
    source: 'rubric-10 "How crowded screens are": at most about 8 page-level actions visible at once (per-row actions in a [data-row-actions] container are not counted)',
    value: c => c.metrics.actions.mainAboveFold ?? null,
    pass: v => v <= 8,
    worse: 'higher',
  },
  {
    key: 'overlap',
    label: 'Text drawn over other text',
    target: '0',
    source: 'rubric-10 "Reading on a phone": nothing cut off or drawn over',
    value: c => c.metrics.overlap?.count ?? null,
    pass: v => v === 0,
    worse: 'higher',
  },
  {
    key: 'strips',
    label: 'Boxes that scroll sideways inside a phone page',
    target: '0',
    source: 'rubric-10 "Getting around on a phone": no sideways-scrolling filter strips; nothing scrolls sideways',
    value: c => (isPhone(c.viewport) && c.metrics.strips ? c.metrics.strips.count : null),
    pass: v => v === 0,
    worse: 'higher',
  },
  {
    key: 'contrastHi',
    label: 'Text under 7:1 (labels 4.5:1) on highlighted rows and tints',
    target: '0',
    source: 'rubric-10 "Contrast": secondary text 7:1, labels 4.5:1, including on highlighted rows',
    value: c => c.metrics.contrastHi?.failing ?? null,
    pass: v => v === 0,
    worse: 'higher',
  },
  {
    key: 'inputs16',
    label: 'Phone text fields under 16 px',
    target: '0',
    source: 'rubric-10 "Reading on a phone": input text 16 px everywhere (no iPhone zoom)',
    value: c => (isPhone(c.viewport) && c.metrics.inputs ? c.metrics.inputs.under16 : null),
    pass: v => v === 0,
    worse: 'higher',
  },
  {
    key: 'cut',
    label: 'Text cut off or past the right edge',
    target: '0',
    source: 'grade B gap 3: cut with no ellipsis, or running off the screen while the page does not scroll',
    value: c => (c.metrics.overflow ? c.metrics.overflow.cut + c.metrics.overflow.offscreen : null),
    pass: v => v === 0,
    worse: 'higher',
  },
]

// The layout gate (report.mjs --gate layout, docs/audit/SCREEN_AUDIT.md): the targets with gate: true (these four and hScroll) fail the
// run. Every other target is advisory. A capture made before a check existed has no value for it and is left out of that row.
TARGETS.push(
  {
    key: 'docScroll',
    label: 'The page itself scrolls (window)',
    target: 'never',
    source: 'layout gate: the app scrolls <main> only; no second scrollbar, nothing cut off below the window',
    value: c => c.metrics.layout?.docScroll?.count ?? null,
    pass: v => v === 0,
    worse: 'higher',
    gate: true,
  },
  {
    key: 'nestedScroll',
    label: 'Boxes that scroll up and down inside the page or a dialog',
    target: '0',
    source: 'layout gate: a second vertical scrollbar inside <main> or a dialog (Today, virtual lists, popovers and a dialog body excepted)',
    value: c => c.metrics.layout?.nestedScroll?.count ?? null,
    pass: v => v === 0,
    worse: 'higher',
    gate: true,
  },
  {
    key: 'boxOverflow',
    label: 'Text hanging out of the bottom of a box',
    target: '0',
    source: 'layout gate: an overflow-visible box shorter than its content, with ordinary text below its bottom edge (a label taller than its row)',
    value: c => c.metrics.layout?.boxOverflow?.count ?? null,
    pass: v => v === 0,
    worse: 'higher',
    gate: true,
  },
  {
    key: 'labelTouchesControl',
    label: 'Text touching an input, select or button that is not its own',
    target: '0',
    source: 'layout gate: text sideways over a control whose top it reaches (within 1 px) or crosses',
    value: c => c.metrics.layout?.labelTouchesControl?.count ?? null,
    pass: v => v === 0,
    worse: 'higher',
    gate: true,
  },
  {
    key: 'unevenWrap',
    label: 'Short labels wrapping beside one-line neighbours (advisory)',
    target: '0 (never fails the gate)',
    source: 'layout gate, advisory: a label of three words or fewer on two lines next to one-line siblings',
    value: c => c.metrics.layout?.unevenWrap?.count ?? null,
    pass: v => v === 0,
    worse: 'higher',
  },
)

// Clarity targets (docs/audit/SCREEN_AUDIT.md, "The clarity ratchet"). All advisory: the clarity gate (report.mjs --gate clarity) does not
// read these, it compares each capture with its own budget (clarity-budgets.json). Words are reported (INFO below), never gated.
const isJobScreen = c => /^(large-)?job-/.test(c.screen)
const isOpenedStep = c => /^op-(step-|supplier-prices)/.test(c.screen)
TARGETS.push(
  {
    key: 'firstWorkY',
    label: 'The first piece of work starts this far down (px)',
    target: 'at most 264',
    source: 'clarity: the work a person came for starts in the first screen, under a short header',
    value: c => c.metrics.clarity?.firstWorkY ?? null,
    pass: v => v <= 264,
    worse: 'higher',
  },
  {
    key: 'boxDepth',
    label: 'Boxes inside boxes (deepest chain)',
    target: 'at most 2',
    source: 'clarity: a box inside a box inside a box is a maze; hairlines and space group instead',
    value: c => c.metrics.clarity?.boxDepth ?? null,
    pass: v => v <= 2,
    worse: 'higher',
  },
  {
    key: 'boxesAtFold',
    label: 'Boxes seen in the first screen',
    target: 'at most 4',
    source: 'clarity: few outlines in the first screen',
    value: c => c.metrics.clarity?.boxesAtFold ?? null,
    pass: v => v <= 4,
    worse: 'higher',
  },
  {
    key: 'stepRowMax',
    label: 'Tallest job step row (px)',
    target: 'at most 52',
    source: 'clarity: a closed job step is one line, 44 to 52 px',
    value: c => c.metrics.clarity?.stepRowMax ?? null,
    pass: v => v <= 52,
    worse: 'higher',
  },
  {
    key: 'todoRowMax',
    label: 'Tallest To do row (px)',
    target: 'at most 140',
    source: 'clarity: a To do row is a few short lines. 140 is the measured 375 value (138) rounded up to 10; the earlier 110 was a guess',
    value: c => c.metrics.clarity?.todoRowMax ?? null,
    pass: v => v <= 140,
    worse: 'higher',
  },
  {
    key: 'aboveFold',
    label: 'Buttons and links above the fold, nothing left out',
    target: 'at most 12',
    source: 'clarity: every button and link seen in the first screen, row actions and navigation too',
    value: c => c.metrics.actions.aboveFold,
    pass: v => v <= 12,
    worse: 'higher',
  },
  {
    key: 'jobHeightClosed',
    label: 'Phone job page, steps closed: page height (px)',
    target: 'at most 1300',
    source: 'clarity: a job on a phone fits in about two screens until a step is opened',
    value: c => (isPhone(c.viewport) && isJobScreen(c) ? c.metrics.contentHeight : null),
    pass: v => v <= 1300,
    worse: 'higher',
  },
  {
    key: 'jobHeightOpened',
    label: 'Phone job page, one step opened: page height (px)',
    target: 'at most 2500',
    source: 'clarity: an opened step adds at most about one more page',
    value: c => (isPhone(c.viewport) && isOpenedStep(c) ? c.metrics.contentHeight : null),
    pass: v => v <= 2500,
    worse: 'higher',
  },
)

// The clarity ratchet (report.mjs --gate clarity): every capture is compared with its own budget in scripts/audit/clarity-budgets.json,
// keyed role/screen/viewport. Worse than the budget fails; equal or better passes; a capture with no budget is reported, never failed.
// Heights and Y values get 8 px of room (a line wrapping differently), counts get none. Words are not here: they are reported only.
export const RATCHET = [
  { key: 'firstWorkY', tolerance: 8, value: c => c.metrics.clarity?.firstWorkY ?? null },
  { key: 'boxDepth', tolerance: 0, value: c => c.metrics.clarity?.boxDepth ?? null },
  { key: 'boxesAtFold', tolerance: 0, value: c => c.metrics.clarity?.boxesAtFold ?? null },
  { key: 'stepRowMax', tolerance: 8, value: c => c.metrics.clarity?.stepRowMax ?? null },
  { key: 'todoRowMax', tolerance: 8, reportOnly: true, value: c => c.metrics.clarity?.todoRowMax ?? null },
  // contentHeight depends on the day's dates and data (the seed's overdue and this-month rows), so it is shown with its budget and delta and never gated.
  { key: 'contentHeight', tolerance: 8, reportOnly: true, value: c => c.metrics.contentHeight ?? null },
  { key: 'aboveFold', tolerance: 0, value: c => c.metrics.actions?.aboveFold ?? null },
]

export const budgetKey = c => `${c.role}/${c.screen}/${c.viewport}`

/** The budgets of these captures: {"role/screen/viewport": {metric: value}}, keys sorted, null metrics left out. */
export function ratchetBudgets(captures) {
  const out = {}
  for (const c of [...captures].sort((a, b) => budgetKey(a).localeCompare(budgetKey(b)))) {
    if (!measured(c)) continue
    const row = {}
    for (const r of RATCHET) {
      const v = r.value(c)
      if (v !== null && v !== undefined) row[r.key] = v
    }
    if (Object.keys(row).length) out[budgetKey(c)] = row
  }
  return out
}

/** One row per capture and metric that is worse than its budget (value above budget + tolerance). No budget for a capture: no row. */
export function ratchetFailures(captures, budgets) {
  const rows = []
  for (const c of captures) {
    if (!measured(c)) continue
    const budget = budgets?.[budgetKey(c)]
    if (!budget) continue
    for (const r of RATCHET) {
      if (r.reportOnly) continue
      const v = r.value(c)
      const b = budget[r.key]
      if (v === null || v === undefined || b === null || b === undefined) continue
      if (v > b + r.tolerance) rows.push({ role: c.role, screen: c.screen, viewport: c.viewport, metric: r.key, value: v, budget: b, tolerance: r.tolerance })
    }
  }
  return rows
}

/** Report-only metrics (contentHeight) that are worse than their budget: listed with the delta, never failed. */
export function ratchetAdvisories(captures, budgets) {
  const rows = []
  for (const c of captures) {
    if (!measured(c)) continue
    const budget = budgets?.[budgetKey(c)]
    if (!budget) continue
    for (const r of RATCHET) {
      if (!r.reportOnly) continue
      const v = r.value(c)
      const b = budget[r.key]
      if (v === null || v === undefined || b === null || b === undefined) continue
      if (v > b + r.tolerance) rows.push({ role: c.role, screen: c.screen, viewport: c.viewport, metric: r.key, value: v, budget: b, delta: v - b })
    }
  }
  return rows
}

/** The measured captures that have no budget yet (reported, never failed). */
export function ratchetUnbudgeted(captures, budgets) {
  return captures.filter(c => measured(c) && !budgets?.[budgetKey(c)]).map(budgetKey)
}

function gateDetail(c, key) {
  const m = c.metrics
  const samples = key === 'hScroll' ? m.hScroll.offenders : (m.layout?.[key]?.samples ?? [])
  return samples.slice(0, 3).join(' | ')
}

/** The captures that fail a gate target, one row per capture and check: the layout gate's verdict. */
export function gateFailures(captures) {
  const rows = []
  for (const c of captures) {
    const sc = score(c)
    for (const t of TARGETS) {
      if (!t.gate) continue
      const r = sc[t.key]
      if (r && !r.pass) rows.push({ role: c.role, screen: c.screen, viewport: c.viewport, key: t.key, value: r.value, detail: gateDetail(c, t.key) })
    }
  }
  return rows
}

/** Markdown for the gate's verdict. */
export function renderGate(failures) {
  if (!failures.length) return ['## Layout gate', '', 'Passed: no page scroll, second scrollbar, hanging text, text on a control or sideways scroll.', '']
  const out = ['## Layout gate', '', `**FAILED: ${failures.length} finding(s).**`, '', '| Check | Role | Screen | Viewport | Value | Where |', '|---|---|---|---|---|---|']
  for (const f of failures) out.push(`| ${f.key} | ${f.role} | \`${f.screen}\` | ${f.viewport} | ${f.value} | ${String(f.detail).replace(/\|/g, '\\|')} |`)
  out.push('')
  return out
}

/** Measured and reported, no target. */
export const INFO = [
  { key: 'actionsFold', label: 'Buttons and links above the fold', value: c => c.metrics.actions.aboveFold, worse: 'higher' },
  { key: 'actions', label: 'Buttons and links on the page', value: c => c.metrics.actions.total, worse: 'higher' },
  { key: 'wordsFold', label: 'Words above the fold', value: c => c.metrics.words.aboveFold, worse: 'higher' },
  { key: 'words', label: 'Words on the page', value: c => c.metrics.words.total, worse: 'higher' },
  { key: 'chips', label: 'Status chips on the page', value: c => c.metrics.chips.total, worse: 'higher' },
  { key: 'scrollers', label: 'Boxes that scroll sideways inside the page', value: c => c.metrics.overflow?.scrollers ?? null, worse: 'higher' },
  { key: 'columns', label: 'Most table columns', value: c => c.metrics.tables.maxColumns, worse: 'higher' },
  {
    key: 'length',
    label: 'Page length (screens)',
    value: c => Math.round((10 * c.metrics.contentHeight) / c.metrics.viewport.height) / 10,
    worse: 'higher',
  },
]

const fmt = (def, v) => (v === null || v === undefined ? '-' : def.format ? def.format(v) : String(Math.round(v * 10) / 10))
const measured = c => c.status === 'ok' && c.metrics

/** Merges result parts ({meta, captures}); a later part (by finishedAt) replaces an earlier capture of the same role, screen and viewport. */
export function mergeParts(parts) {
  const sorted = [...parts].sort((a, b) => String(a.meta?.finishedAt ?? '').localeCompare(String(b.meta?.finishedAt ?? '')))
  const byKey = new Map()
  const screenOrder = []
  const viewports = []
  for (const part of sorted) {
    for (const v of part.meta?.viewports ?? []) if (!viewports.includes(v)) viewports.push(v)
    for (const c of part.captures ?? []) {
      if (!screenOrder.includes(c.screen)) screenOrder.push(c.screen)
      if (!viewports.includes(c.viewport)) viewports.push(c.viewport)
      byKey.set(`${c.role}|${c.screen}|${c.viewport}`, c)
    }
  }
  const captures = [...byKey.values()].sort(
    (a, b) =>
      ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
      screenOrder.indexOf(a.screen) - screenOrder.indexOf(b.screen) ||
      viewports.indexOf(a.viewport) - viewports.indexOf(b.viewport),
  )
  const first = k => sorted.map(p => p.meta?.[k]).find(Boolean) ?? ''
  const meta = {
    ref: first('ref'),
    sha: first('sha'),
    roles: ROLE_ORDER.filter(r => captures.some(c => c.role === r)),
    viewports,
    startedAt: sorted.map(p => p.meta?.startedAt).filter(Boolean).sort()[0] ?? '',
    finishedAt: sorted.map(p => p.meta?.finishedAt).filter(Boolean).sort().pop() ?? '',
  }
  return { meta, captures }
}

/** Every target's value and pass/fail for one capture. */
export function score(c) {
  const out = {}
  if (!measured(c)) return out
  for (const t of TARGETS) {
    const v = t.value(c)
    if (v === null || v === undefined) continue
    out[t.key] = { value: v, pass: t.pass(v, c) }
  }
  return out
}

function worstOf(captures, def, n) {
  const best = new Map()
  for (const c of captures) {
    if (!measured(c)) continue
    const v = def.value(c)
    if (v === null || v === undefined) continue
    // one row per screen: the role and viewport where it is worst (the same screen for three roles would fill the list)
    const key = c.screen
    const prev = best.get(key)
    const worse = !prev || (def.worse === 'lower' ? v < prev.value : v > prev.value)
    if (worse) best.set(key, { role: c.role, screen: c.screen, title: c.title, viewport: c.viewport, value: v })
  }
  return [...best.values()].sort((a, b) => (def.worse === 'lower' ? a.value - b.value : b.value - a.value)).slice(0, n)
}

export function summarise({ meta, captures }) {
  const byTarget = {}
  for (const t of TARGETS) {
    const row = { applicable: 0, passed: 0, byViewport: {} }
    for (const vp of meta.viewports) row.byViewport[vp] = { applicable: 0, passed: 0 }
    for (const c of captures) {
      const s = score(c)[t.key]
      if (!s) continue
      row.applicable++
      if (s.pass) row.passed++
      const v = (row.byViewport[c.viewport] ??= { applicable: 0, passed: 0 })
      v.applicable++
      if (s.pass) v.passed++
    }
    byTarget[t.key] = row
  }
  const worst = {}
  for (const d of [...TARGETS, ...INFO]) worst[d.key] = worstOf(captures, d, 5)
  const status = {}
  for (const c of captures) status[c.status] = (status[c.status] ?? 0) + 1
  return { captures: captures.length, status, byTarget, worst }
}

const rate = r => (r.applicable ? `${Math.round((100 * r.passed) / r.applicable)}% (${r.passed}/${r.applicable})` : '-')
const cell = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
const bold = (s, fail) => (fail ? `**${s}**` : s)

function captureRow(c) {
  const vp = c.viewport
  if (!measured(c)) {
    const why = c.status === 'error' ? `error: ${c.error ?? ''}` : c.status
    const shot = c.shots?.error ? ` [screen](${c.shots.error})` : c.shots?.fold ? ` [fold](${c.shots.fold})` : ''
    return `| ${vp} | ${cell(why)}${shot} |${' |'.repeat(17)}`
  }
  const m = c.metrics
  const s = score(c)
  const t = m.text
  const show = key => {
    const def = TARGETS.find(d => d.key === key)
    const r = s[key]
    return r ? bold(fmt(def, r.value), !r.pass) : '-'
  }
  const p = v => (v === null ? '-' : `${Math.round(v)}%`)
  const tap = m.tap ? `${show('tap')} (min ${m.tap.minPx ?? '-'})` : '-'
  const axe = c.axe ? `${show('axe')} / ${c.axe.rules} rules` : '-'
  const length = INFO.find(d => d.key === 'length').value(c)
  const shots = [c.shots?.fold ? `[fold](${c.shots.fold})` : '', c.shots?.full ? `[full](${c.shots.full})` : ''].filter(Boolean).join(' ')
  return (
    `| ${vp} | ${m.actions.aboveFold} / ${m.actions.total} | ${show('primary')} | ${show('green')} | ${show('headerChips')} | ${m.chips.total} | ${m.tables.maxColumns || '-'} ` +
    `| ${m.words.aboveFold} / ${m.words.total} | ${p(pct(t.under14, t.chars))} | ${show('text14')} | ${show('hScroll')} | ${tap} | ${show('nav')} ` +
    `| ${show('clipped')} | ${show('overlap')} | ${show('cut')} | ${axe} | ${length} | ${shots} |`
  )
}

function details(group) {
  const lines = []
  for (const c of group) {
    if (!measured(c)) continue
    const m = c.metrics
    const bits = []
    if (m.primary.inMain > 1) bits.push(`primary: ${m.primary.labels.map(l => `"${l}"`).join(', ')}`)
    if (m.primary.onScreen > 1) bits.push(`green on screen: ${m.primary.onScreenLabels.map(l => `"${l}"`).join(', ')}`)
    if (m.primary.onScreen === 0) bits.push('info: no green button on screen')
    if (m.chips.header > 2) bits.push(`header chips (${m.chips.headerMethod}): ${m.chips.headerLabels.map(l => `"${l}"`).join(', ')}`)
    if (m.nav.levels > 2) bits.push(`nav: ${m.nav.labels.join('; ')}`)
    if (m.hScroll.offenders.length) bits.push(`too wide: ${m.hScroll.offenders.slice(0, 3).join('; ')}`)
    if (m.tap?.under44) bits.push(`small targets: ${m.tap.worst.slice(0, 4).map(w => `"${w.label}" ${w.w}x${w.h}`).join(', ')}`)
    if (m.clipped.count) bits.push(`clipped: ${m.clipped.samples.slice(0, 3).map(x => `"${x.text}"`).join(', ')}`)
    for (const kind of ['cut', 'offscreen', 'scroller']) {
      const xs = (m.overflow?.samples ?? []).filter(x => x.kind === kind)
      if (xs.length) bits.push(`${kind === 'scroller' ? 'scrolls sideways' : kind === 'cut' ? 'cut off' : 'past right edge'}: ${xs.slice(0, 3).map(x => x.what).join(', ')}`)
    }
    if (c.axe?.nodes) bits.push(`axe: ${Object.entries(c.axe.byRule).map(([k, v]) => `${k} x${v}`).join(', ')}`)
    const greens = m.primary.inMain + m.primary.inChrome
    if (greens !== 1 && !(greens === 0 && m.noPrimary)) bits.push(`green buttons ${m.primary.inMain} in page + ${m.primary.inChrome} in top bar${m.primary.labels.length ? ` (${m.primary.labels.map(l => `"${l}"`).join(', ')})` : ''}`)
    if ((m.actions.mainAboveFold ?? 0) > 8) bits.push(`${m.actions.mainAboveFold} actions above the fold in the page${m.actions.mainLabels?.length ? ` (${m.actions.mainLabels.map(l => `"${l}"`).join(', ')})` : ''}`)
    if (m.overlap?.count) bits.push(`text over text: ${m.overlap.samples.slice(0, 3).join(', ')}`)
    if (isPhone(c.viewport) && m.strips?.count) bits.push(`scrolls sideways inside: ${m.strips.samples.slice(0, 3).join('; ')}`)
    if (m.contrastHi?.failing) bits.push(`low contrast on highlight: ${m.contrastHi.samples.slice(0, 3).join(', ')}`)
    if (m.inputs?.under16) bits.push(`inputs under 16 px: ${m.inputs.samples.slice(0, 3).join(', ')}`)
    const lay = m.layout
    if (lay?.docScroll?.count) bits.push(`page scrolls: ${lay.docScroll.samples.slice(0, 4).join('; ')}`)
    if (lay?.nestedScroll?.count) bits.push(`second scrollbar: ${lay.nestedScroll.samples.slice(0, 3).join('; ')}`)
    if (lay?.boxOverflow?.count) bits.push(`text hangs out of its box: ${lay.boxOverflow.samples.slice(0, 3).join('; ')}`)
    if (lay?.labelTouchesControl?.count) bits.push(`text on a control: ${lay.labelTouchesControl.samples.slice(0, 3).join('; ')}`)
    if (lay?.unevenWrap?.count) bits.push(`info: uneven wrap: ${lay.unevenWrap.samples.slice(0, 2).join('; ')}`)
    if (bits.length) lines.push(`- ${c.viewport}: ${bits.map(cell).join(' | ')}`)
  }
  return lines
}

export function renderMarkdown(results) {
  const { meta, captures, summary } = results
  const out = []
  const sha = meta.sha ? ` at \`${meta.sha.slice(0, 7)}\`` : ''
  out.push(`# Screen audit: ${meta.ref || 'local'}${sha}`, '')
  out.push(
    `${summary.captures} captures: ${meta.roles.join(', ')} at ${meta.viewports.join(', ')}. ` +
      `Measured ${meta.finishedAt || meta.startedAt}. Status: ${Object.entries(summary.status)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}.`,
    '',
    'Measured in the built app on the local CI stack with seeded data (docs/audit/SCREEN_AUDIT.md says how each number is taken). ' +
      'A **bold** value misses its target. "fold" is one screen without scrolling.',
    '',
  )

  out.push('## Targets', '')
  out.push(`| Metric | Target | Passing | ${meta.viewports.join(' | ')} | From |`)
  out.push(`|---|---|---|${meta.viewports.map(() => '---').join('|')}|---|`)
  for (const t of TARGETS) {
    const r = summary.byTarget[t.key]
    out.push(`| ${t.label} | ${t.target} | ${rate(r)} | ${meta.viewports.map(v => rate(r.byViewport[v] ?? { applicable: 0 })).join(' | ')} | ${t.source} |`)
  }
  out.push('')

  out.push(...renderGate(gateFailures(captures)))
  out.push('## Worst 5 screens per metric', '', 'Each screen once, at its worst role and viewport.', '')
  for (const d of [...TARGETS, ...INFO]) {
    const rows = summary.worst[d.key]
    if (!rows.length) continue
    out.push(`### ${d.label}${d.target ? ` (target ${d.target})` : ''}`, '')
    out.push('| # | Role | Screen | Viewport | Value |', '|---|---|---|---|---|')
    rows.forEach((w, i) => out.push(`| ${i + 1} | ${w.role} | ${cell(w.title)} (\`${w.screen}\`) | ${w.viewport} | ${fmt(d, w.value)} |`))
    out.push('')
  }

  const problems = captures.filter(c => c.status !== 'ok')
  if (problems.length) {
    out.push('## Not measured', '')
    for (const c of problems) out.push(`- ${c.role} \`${c.screen}\` ${c.viewport}: ${cell(c.status === 'error' ? `error: ${c.error ?? ''}` : c.status)}`)
    out.push('')
  }

  out.push('## Per screen', '')
  out.push(
    'Columns: buttons and links (fold / page); primary buttons in the page; green buttons on screen (page plus bars); status chips in the header; chips on the page; most table columns; ' +
      'words (fold / page); share of characters under 14 px; share at 14 px or more; sideways scroll; ' +
      'phone tap targets under 44 px (smallest); navigation strips; clipped text; text over text; text cut off or past the right edge; ' +
      'axe failing nodes / rules; page length in screens; screenshots.',
    '',
  )
  const groups = new Map()
  for (const c of captures) {
    const k = `${c.role}|${c.screen}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(c)
  }
  for (const group of groups.values()) {
    const c0 = group[0]
    const url = group.find(measured)?.metrics.url
    out.push(`### ${c0.role} / ${c0.title} (\`${c0.screen}\`)`, '')
    if (url) out.push(`\`${url}\``, '')
    out.push('| Viewport | Actions | Primary | Green | Hdr chips | Chips | Cols | Words | <14px | 14px+ | Sideways | Tap <44 | Nav | Clipped | Overlap | Cut | axe | Length | Shots |')
    out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for (const c of group) out.push(captureRow(c))
    const d = details(group)
    if (d.length) out.push('', ...d)
    out.push('')
  }
  return out.join('\n')
}

/** The short part (targets and worst lists) for the workflow summary. */
export function renderSummary(results) {
  const md = renderMarkdown(results)
  const cut = md.indexOf('\n## Per screen')
  return cut > 0 ? md.slice(0, cut) : md
}

export function buildResults(parts) {
  const merged = mergeParts(parts)
  const summary = summarise(merged)
  const failures = gateFailures(merged.captures)
  return {
    gate: { layout: { failed: failures.length, failures } },
    meta: { ...merged.meta, generatedAt: new Date().toISOString() },
    targets: TARGETS.map(({ key, label, target, source }) => ({ key, label, target, source })),
    summary,
    captures: merged.captures.map(c => ({ ...c, score: score(c) })),
  }
}
