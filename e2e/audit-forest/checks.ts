import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import { CURRENCY_AMOUNT, ENGINEER_MONEY_WORDS, GST_AMOUNT } from '../verify-roles/routes'
import { waitAnimations } from './lib'

/*
 * The Forest audit's rules. `inspect` runs INSIDE the page (page.evaluate serialises it): it must not use anything from this
 * module's scope, every helper is declared inside it. Each rule returns { rule, selector, detail }; the spec adds where it was.
 *
 *   doc-overflow        html, body or #main scrolls sideways (scrollWidth > clientWidth)
 *   past-viewport       a visible element reaches past the viewport's left or right edge, not inside a scroll box
 *   cut-off             a control or a piece of text is cut by an ancestor with overflow hidden/clip (not a scroll box)
 *   sideways-box        a scroll box that scrolls sideways and holds no table or grid (a table wrapper is the intended pattern)
 *   clipped-text        ellipsis, line-clamp or overflow hidden cuts text, and no title or aria-label carries the whole text
 *   overlap             two controls' boxes intersect (neither inside the other)
 *   covered             the point at a control's centre is another element (not the control, its child or its label)
 *   touch-target-44     phones: a control under 44 px in width or height (inline links in a sentence excepted, WCAG 2.5.8)
 *   touch-target-48     phones (coarse pointer): a control of 44 to 47 px (Forest's touch size is 48)
 *   input-zoom          phones: an input, select or textarea under 16 px text (iOS zooms the page in)
 *   tiny-text           visible text under 12 px
 *   dup-id, nested-interactive, invalid-nesting, phrasing-nesting, li-outside-list, img-no-alt, unnamed-control, table-no-headers,
 *   heading-skip, multiple-h1, no-h1   rendered-DOM HTML validity
 */
export interface Raw {
  rule: string
  selector: string
  detail: string
}

export interface InspectArgs {
  phone: boolean
  /** A selector the checks are limited to (an open dialog), or null for the page. */
  scope: string | null
}

export function inspect(a: InspectArgs): Raw[] {
  const out: Raw[] = []
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  const text = (el: Element) => ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim()
  const sel = (el: Element): string => {
    const parts: string[] = []
    let e: Element | null = el
    for (let i = 0; e && i < 4 && e !== document.body; i++, e = e.parentElement) {
      let p = e.tagName.toLowerCase()
      if (e.id && !/^radix-|^:r/.test(e.id)) {
        parts.unshift(`${p}#${e.id}`)
        break
      }
      const tid = e.getAttribute('data-testid')
      if (tid) {
        parts.unshift(`${p}[data-testid="${tid}"]`)
        break
      }
      const cls = Array.from(e.classList).filter(c => !/[:[\]/]/.test(c)).slice(0, 2)
      if (cls.length) p += `.${cls.join('.')}`
      const role = e.getAttribute('role')
      if (role) p += `[role=${role}]`
      parts.unshift(p)
    }
    const t = text(el).slice(0, 40)
    const lab = el.getAttribute('aria-label')
    return `${parts.join(' > ')}${lab ? ` [aria-label="${lab.slice(0, 40)}"]` : ''}${t ? ` "${t}"` : ''}`
  }
  const add = (rule: string, el: Element | null, detail: string) => out.push({ rule, selector: el ? sel(el) : '', detail })
  const visible = (el: Element): boolean => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return false
    const he = el as HTMLElement
    if (typeof he.checkVisibility === 'function' && !he.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false
    if (el.closest('[inert], .sr-only')) return false
    return true
  }
  const root: Element = (a.scope && document.querySelector(a.scope)) || document.body
  const all = Array.from(root.querySelectorAll('*')).filter(e => !(e instanceof SVGElement && !(e instanceof SVGSVGElement)))
  const vis = all.filter(visible)

  // ---- page scroll
  if (!a.scope) {
    const main = document.getElementById('main')
    for (const [name, el] of [['html', document.documentElement], ['body', document.body], ['#main', main]] as const) {
      if (el && el.scrollWidth > el.clientWidth + 1) add('doc-overflow', el, `${name} scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`)
    }
  }

  // ---- past the viewport, cut off, sideways boxes
  const clipAncestor = (el: Element): { el: Element; kind: 'scroll' | 'clip' } | null => {
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (p.id === 'main') return null
      if (/(auto|scroll)/.test(s.overflowX)) return { el: p, kind: 'scroll' }
      if (/(hidden|clip)/.test(s.overflowX)) return { el: p, kind: 'clip' }
    }
    return null
  }
  const ownText = (el: Element) => Array.from(el.childNodes).some(n => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0)
  const INTERACTIVE = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="option"], [role="combobox"], [role="radio"], [tabindex]:not([tabindex="-1"])'
  const flagged = new Set<Element>()
  let past = 0
  let cut = 0
  for (const el of vis) {
    const cs = getComputedStyle(el)
    if (cs.position === 'fixed') continue
    const r = el.getBoundingClientRect()
    const parentFlagged = el.parentElement && flagged.has(el.parentElement)
    if (r.right > vw + 1 || r.left < -1) {
      const c = clipAncestor(el)
      if (!c && !parentFlagged && past < 12) {
        flagged.add(el)
        past++
        add('past-viewport', el, `x ${Math.round(r.left)}..${Math.round(r.right)} in a ${vw} px viewport`)
        continue
      }
    }
    if ((el.matches(INTERACTIVE) || ownText(el)) && !parentFlagged) {
      const c = clipAncestor(el)
      if (c && c.kind === 'clip') {
        const cr = c.el.getBoundingClientRect()
        const over = Math.max(r.right - cr.right, cr.left - r.left, 0)
        const overY = /(hidden|clip)/.test(getComputedStyle(c.el).overflowY) ? Math.max(r.bottom - cr.bottom, cr.top - r.top, 0) : 0
        // a box that only animates (a carousel, a collapsible) has its own aria state; a truncating text box is the clipped-text rule
        if ((over > 2 || overY > 2) && cut < 12 && !c.el.matches('[data-state="closed"], [aria-hidden="true"]') && !(el === c.el)) {
          flagged.add(el)
          cut++
          add('cut-off', el, `cut ${Math.round(over)} px sideways, ${Math.round(overY)} px down by ${sel(c.el).slice(0, 80)}`)
        }
      }
    }
  }
  for (const el of vis) {
    const cs = getComputedStyle(el)
    if (!/(auto|scroll)/.test(cs.overflowX) || el.id === 'main' || el === document.documentElement || el === document.body) continue
    if (el.scrollWidth <= el.clientWidth + 1) continue
    if (el.querySelector('table, [role="table"], [role="grid"], [role="tablist"], pre, code') || el.matches('[role="tablist"], nav, pre, code')) continue
    add('sideways-box', el, `scrolls sideways: ${el.scrollWidth} px of content in ${el.clientWidth} px`)
  }

  // ---- clipped text without the whole text on hover or for a screen reader
  const fullTextNear = (el: Element, t: string): boolean => {
    for (let e: Element | null = el, i = 0; e && i < 4; e = e.parentElement, i++) {
      const title = e.getAttribute('title') ?? ''
      const lab = e.getAttribute('aria-label') ?? ''
      if ((title && title.replace(/\s+/g, ' ').includes(t.slice(0, 60))) || (lab && lab.replace(/\s+/g, ' ').includes(t.slice(0, 60)))) return true
    }
    return false
  }
  let clippedN = 0
  for (const el of vis) {
    if (!ownText(el) || clippedN >= 15) continue
    const cs = getComputedStyle(el)
    const hidX = /(hidden|clip)/.test(cs.overflowX)
    const hidY = /(hidden|clip)/.test(cs.overflowY)
    const clamp = cs.getPropertyValue('-webkit-line-clamp')
    const clampOn = clamp && clamp !== 'none'
    const wide = hidX && el.scrollWidth > el.clientWidth + 1
    const tall = (clampOn || hidY) && el.scrollHeight > el.clientHeight + 3
    if (!wide && !tall) continue
    const t = text(el)
    if (!t || fullTextNear(el, t)) continue
    clippedN++
    add('clipped-text', el, `${wide ? `${el.scrollWidth}>${el.clientWidth} px wide` : ''}${tall ? `${el.scrollHeight}>${el.clientHeight} px tall` : ''}${cs.textOverflow === 'ellipsis' ? ' (ellipsis)' : ''}${clampOn ? ` (line-clamp ${clamp})` : ''}; full text not in a title or aria-label`)
  }

  // ---- controls: overlap, covered, touch size, input text size
  const controls = vis.filter(e => e.matches(INTERACTIVE) && !e.matches('[aria-hidden="true"] *'))
  const leaf = controls.filter(c => !controls.some(o => o !== c && c.contains(o) && o.matches('button, a[href], input, select, textarea')))
  const rects = leaf.map(e => ({ e, r: e.getBoundingClientRect() }))
  let overlaps = 0
  for (let i = 0; i < rects.length && overlaps < 10; i++) {
    for (let j = i + 1; j < rects.length && overlaps < 10; j++) {
      const A = rects[i]
      const B = rects[j]
      if (A.e.contains(B.e) || B.e.contains(A.e)) continue
      const ix = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left)
      const iy = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top)
      if (ix > 2 && iy > 2) {
        // a label wrapping its own input, or an input and its own clear/toggle drawn inside the same field box
        const la = A.e.closest('label')
        const lb = B.e.closest('label')
        if (la && la === lb) continue
        // a field's own adornment (show password, clear, a unit or a picker toggle) drawn inside the field box
        const field = (x: Element) => x.matches('input, textarea, select, [role="combobox"]')
        const abs = (x: Element) => getComputedStyle(x).position === 'absolute'
        if ((field(A.e) || field(B.e)) && (abs(A.e) || abs(B.e)) && (A.e.parentElement === B.e.parentElement || A.e.parentElement?.parentElement === B.e.parentElement?.parentElement)) continue
        overlaps++
        add('overlap', A.e, `intersects ${sel(B.e).slice(0, 90)} by ${Math.round(ix)}x${Math.round(iy)} px`)
      }
    }
  }
  const scrollClip = (el: Element, x: number, y: number): boolean => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX + s.overflowY)) {
        const pr = p.getBoundingClientRect()
        if (x < pr.left || x > pr.right || y < pr.top || y > pr.bottom) return true
      }
    }
    return false
  }
  let covered = 0
  for (const { e, r } of rects) {
    if (covered >= 10) break
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    if (x < 0 || y < 0 || x > vw || y > vh || scrollClip(e, x, y)) continue
    const hit = document.elementFromPoint(x, y)
    if (!hit || e.contains(hit) || hit.contains(e)) continue
    const lab = (e as HTMLInputElement).labels
    if (lab && Array.from(lab).some(l => l.contains(hit))) continue
    // a sticky or fixed bar the content scrolls under (the top bar, the phone tab bar, a sticky action bar): normal scrolling, not a bug
    let fixedHit = false
    for (let p: Element | null = hit; p && p !== document.body; p = p.parentElement) {
      const pos = getComputedStyle(p).position
      if (pos === 'fixed' || pos === 'sticky') {
        fixedHit = !p.contains(e)
        break
      }
    }
    if (fixedHit) continue
    if (a.scope === null && hit.closest('[role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper]')) continue
    covered++
    add('covered', e, `centre (${Math.round(x)},${Math.round(y)}) is covered by ${sel(hit).slice(0, 90)}`)
  }
  if (a.phone) {
    let small = 0
    for (const { e, r } of rects) {
      if (small >= 20) break
      if (r.right < 0 || r.left > vw) continue
      if (e.matches('input[type="checkbox"], input[type="radio"]') && Number(getComputedStyle(e).opacity) === 0) continue
      // WCAG 2.5.8 exception: a link inside a sentence
      if (e.matches('a') && e.parentElement && e.parentElement.matches('p, li, span, small, dd, td') && text(e.parentElement).length > text(e).length + 10) continue
      const m = Math.min(r.width, r.height)
      if (m < 44) {
        small++
        add('touch-target-44', e, `${Math.round(r.width)}x${Math.round(r.height)} px`)
      } else if (m < 48) {
        small++
        add('touch-target-48', e, `${Math.round(r.width)}x${Math.round(r.height)} px (Forest touch size 48)`)
      }
    }
    for (const el of vis.filter(e => e.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="color"]), select, textarea'))) {
      const fs = parseFloat(getComputedStyle(el).fontSize)
      if (fs < 16) add('input-zoom', el, `font-size ${fs}px (under 16 px, iOS zooms in)`)
    }
  }
  let tiny = 0
  for (const el of vis) {
    if (tiny >= 6 || !ownText(el)) continue
    const fs = parseFloat(getComputedStyle(el).fontSize)
    if (fs < 12) {
      tiny++
      add('tiny-text', el, `${fs}px text`)
    }
  }

  // ---- rendered-DOM HTML validity (document-wide when the scope is the page)
  const doc = a.scope ? root : document
  const ids = new Map<string, number>()
  for (const el of Array.from(doc.querySelectorAll('[id]'))) ids.set(el.id, (ids.get(el.id) ?? 0) + 1)
  for (const [id, n] of ids) if (n > 1 && id) add('dup-id', doc.querySelector(`[id="${CSS.escape(id)}"]`), `id "${id}" used ${n} times`)
  for (const el of Array.from(doc.querySelectorAll('button button, button a[href], a[href] a[href], a[href] button, button input, a[href] input, a[href] select, button select, [role="button"] button, [role="button"] a[href], label label')))
    add('nested-interactive', el, `inside ${sel(el.parentElement?.closest('button, a[href], [role="button"], label') ?? el).slice(0, 80)}`)
  const nest = (rule: string, q: string) => {
    let k = 0
    for (const el of Array.from(doc.querySelectorAll(q))) {
      if (el.closest('svg') || k++ >= 10) continue
      const host = el.parentElement?.closest('p, button, span, label, ul, ol, dl, a')
      add(rule, el, `<${el.tagName.toLowerCase()}> inside <${el.parentElement?.tagName.toLowerCase()}>${host && host !== el.parentElement ? ` (in <${host.tagName.toLowerCase()}>)` : ''}`)
    }
  }
  // content the HTML parser would move or drop (React renders it, the markup is still invalid)
  nest('invalid-nesting', 'p div, p p, p ul, p ol, p section, p table, p h1, p h2, p h3, p h4, p form, p dl, p blockquote, p hr, ul > :not(li):not(script):not(template), ol > :not(li):not(script):not(template), dl > :not(dt):not(dd):not(div):not(script)')
  // block content inside phrasing-only elements (button, span, label, a heading inside a link is allowed): harmless to browsers, invalid HTML
  nest('phrasing-nesting', 'button div, button p, button h1, button h2, button h3, button h4, button ul, span div, span p, span ul, label div, label p')
  for (const el of Array.from(doc.querySelectorAll('li'))) if (!el.parentElement || !el.parentElement.matches('ul, ol, menu, [role="list"], [role="listbox"], [role="menu"]')) add('li-outside-list', el, `<li> in <${el.parentElement?.tagName.toLowerCase()}>`)
  for (const el of Array.from(doc.querySelectorAll('img:not([alt])'))) add('img-no-alt', el, 'img without alt')
  const nameOf = (el: Element): string => {
    const lab = el.getAttribute('aria-label') ?? ''
    const lby = (el.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .map(i => (i ? (document.getElementById(i)?.textContent ?? '') : ''))
      .join(' ')
    const alt = Array.from(el.querySelectorAll('img[alt], svg title')).map(i => i.getAttribute('alt') ?? i.textContent ?? '').join(' ')
    const own = (el as HTMLElement).innerText ?? ''
    const inp = el as HTMLInputElement
    const lbls = inp.labels ? Array.from(inp.labels).map(l => l.textContent ?? '').join(' ') : ''
    return `${lab}${lby}${alt}${own}${el.getAttribute('title') ?? ''}${lbls}${(el as HTMLInputElement).placeholder ?? ''}${el.matches('input[type="submit"], input[type="button"]') ? (inp.value ?? '') : ''}`.trim()
  }
  for (const el of Array.from(doc.querySelectorAll('button, a[href], [role="button"], [role="link"], input:not([type="hidden"]), select, textarea')).filter(visible))
    if (!nameOf(el)) add('unnamed-control', el, `<${el.tagName.toLowerCase()}> has no accessible name`)
  for (const t of Array.from(doc.querySelectorAll('table')).filter(visible)) {
    if (t.matches('[role="presentation"], [role="none"]')) continue
    if (!t.querySelector('th, [role="columnheader"], [role="rowheader"]')) add('table-no-headers', t, 'a data table with no th')
  }
  const hs = Array.from((a.scope ? root : document.getElementById('main') ?? document.body).querySelectorAll('h1, h2, h3, h4, h5, h6')).filter(h => (h as HTMLElement).offsetParent !== null || h.closest('.sr-only'))
  let last = a.scope ? 1 : 0
  for (const h of hs) {
    const n = Number(h.tagName[1])
    if (last && n > last + 1) add('heading-skip', h, `h${last} then h${n}`)
    last = n
  }
  if (!a.scope) {
    const h1s = Array.from(document.querySelectorAll('h1')).filter(h => visible(h) || h.closest('.sr-only'))
    if (h1s.length > 1) add('multiple-h1', h1s[1], `${h1s.length} h1 on the page: ${h1s.map(h => `"${text(h).slice(0, 30)}"`).join(', ')}`)
    if (h1s.length === 0 && document.getElementById('main')) add('no-h1', document.getElementById('main'), 'no h1 on the page')
  }
  return out
}

// ---------------------------------------------------------------- axe
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']

interface AxeNode {
  target: unknown
  failureSummary?: string
}
interface AxeResult {
  id: string
  impact: string | null
  help: string
  tags: string[]
  nodes: AxeNode[]
}

export async function axe(page: Page, scope: string | null): Promise<Raw[]> {
  await page.evaluate(axeSource)
  const res = await page.evaluate(
    async ({ tags, scope }) => {
      const ax = (window as unknown as { axe: { run: (ctx: unknown, opts: object) => Promise<{ violations: AxeResult[]; incomplete: AxeResult[] }> } }).axe
      const ctx = scope && document.querySelector(scope) ? { include: [scope] } : document
      const r = await ax.run(ctx, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'], rules: { region: { enabled: !scope } } })
      const slim = (x: AxeResult[]) => x.map(v => ({ id: v.id, impact: v.impact, help: v.help, tags: v.tags, nodes: v.nodes.slice(0, 12).map(n => ({ target: n.target, failureSummary: n.failureSummary })) }))
      return { violations: slim(r.violations), incomplete: slim(r.incomplete.filter(i => i.id === 'color-contrast')) }
    },
    { tags: AXE_TAGS, scope },
  )
  const out: Raw[] = []
  for (const v of res.violations)
    for (const n of v.nodes) out.push({ rule: `axe:${v.id}`, selector: JSON.stringify(n.target), detail: `${v.impact ?? ''}${v.tags.includes('best-practice') ? ' best-practice' : ''}: ${(n.failureSummary ?? v.help).replace(/\s+/g, ' ').slice(0, 300)}` })
  for (const v of res.incomplete)
    if (v.nodes.length)
      out.push({ rule: 'axe-review:color-contrast', selector: JSON.stringify(v.nodes.slice(0, 4).map(n => n.target)), detail: `${v.nodes.length} node(s) axe could not measure (text over a gradient, an image or overlapping boxes): look at them` })
  return out
}

// ---------------------------------------------------------------- focus
interface FocusStep {
  sel: string
  tag: string
  visible: boolean
  inView: boolean
  ring: 'ring' | 'weak' | 'none'
  detail: string
}

/** Tabs through the first `n` focusable elements; each must show a visible change (outline, ring, border) when focused. */
export async function focusSweep(page: Page, n = 15, scope: string | null = null): Promise<Raw[]> {
  const out: Raw[] = []
  await page.evaluate(s => {
    const start = (s && document.querySelector(s)) || document.body
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    // start from the top of the scope: focus a temporary sentinel before its first element
    const t = document.createElement('span')
    t.tabIndex = -1
    t.setAttribute('data-audit-sentinel', '')
    start.prepend(t)
    t.focus({ preventScroll: true })
  }, scope)
  const seen = new Set<string>()
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab')
    await waitAnimations(page, 600)
    const step = await page.evaluate((): FocusStep | null => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) return null
      const PROPS = ['outline-style', 'outline-width', 'outline-color', 'box-shadow', 'border-top-color', 'border-bottom-color', 'border-bottom-width', 'background-color', 'text-decoration-line', 'color']
      const chain = (): Element[] => {
        const c: Element[] = [el]
        for (let p = el.parentElement, k = 0; p && k < 3; p = p.parentElement, k++) c.push(p)
        return c
      }
      const snap = () =>
        chain().flatMap(e => {
          const a = getComputedStyle(e)
          const b = getComputedStyle(e, '::after')
          const bf = getComputedStyle(e, '::before')
          return [...PROPS.map(p => a.getPropertyValue(p)), b.getPropertyValue('box-shadow'), b.getPropertyValue('outline-style'), b.getPropertyValue('border-top-color'), bf.getPropertyValue('box-shadow')]
        })
      const focused = snap()
      el.blur()
      // the transition (if any) back to the resting look must finish before it is read
      const anims = document.getAnimations()
      for (const x of anims) {
        try {
          x.finish()
        } catch {
          /* infinite */
        }
      }
      const rest = snap()
      el.focus({ preventScroll: true })
      for (const x of document.getAnimations()) {
        try {
          x.finish()
        } catch {
          /* infinite */
        }
      }
      const ringIdx = new Set<number>()
      const per = PROPS.length + 4
      focused.forEach((v, i) => {
        if (v !== rest[i]) ringIdx.add(i % per)
      })
      const strong = [0, 1, 2, 3, 4, 5, 6, per - 4, per - 3, per - 2, per - 1].some(i => ringIdx.has(i))
      const weak = [7, 8, 9].some(i => ringIdx.has(i))
      const r = el.getBoundingClientRect()
      const id = el.id ? `#${el.id}` : ''
      const name = (el.getAttribute('aria-label') ?? el.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
      return {
        sel: `${el.tagName.toLowerCase()}${id} "${name}"`,
        tag: el.tagName.toLowerCase(),
        visible: r.width >= 2 && r.height >= 2,
        inView: r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth,
        ring: strong ? 'ring' : weak ? 'weak' : 'none',
        detail: `${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.left)},${Math.round(r.top)}`,
      }
    })
    if (!step) break
    if (seen.has(step.sel)) continue
    seen.add(step.sel)
    if (!step.visible || !step.inView) out.push({ rule: 'focus-hidden', selector: step.sel, detail: `Tab ${i + 1} lands on an element a person cannot see (${step.detail})` })
    else if (step.ring === 'none') out.push({ rule: 'focus-invisible', selector: step.sel, detail: `Tab ${i + 1}: no outline, ring or border change on focus` })
    else if (step.ring === 'weak') out.push({ rule: 'focus-weak', selector: step.sel, detail: `Tab ${i + 1}: only the background or text colour changes on focus (no ring)` })
  }
  await page.evaluate(() => document.querySelectorAll('[data-audit-sentinel]').forEach(e => e.remove())).catch(() => undefined)
  return out
}

// ---------------------------------------------------------------- engineer
/** Money words, amounts, GST amounts and real PO / invoice numbers on an engineer's screen. */
export async function engineerMoney(page: Page, secrets: readonly string[]): Promise<Raw[]> {
  const text = await page.evaluate(() => document.body.innerText).catch(() => '')
  const out: Raw[] = []
  for (const [rule, re] of [
    ['engineer-money-word', ENGINEER_MONEY_WORDS],
    ['engineer-amount', CURRENCY_AMOUNT],
    ['engineer-gst-amount', GST_AMOUNT],
  ] as const) {
    const m = text.match(new RegExp(`.{0,40}(${re.source}).{0,40}`))
    if (m) out.push({ rule, selector: 'body', detail: `"${m[0].replace(/\s+/g, ' ')}"` })
  }
  for (const s of secrets) {
    if (text.includes(s)) {
      out.push({ rule: 'engineer-po-invoice-number', selector: 'body', detail: `shows "${s}"` })
      break
    }
  }
  return out
}
