/*
 * The DOM measurements of one screen at one viewport (docs/audit/SCREEN_AUDIT.md). `collect` runs INSIDE the page
 * (page.evaluate serialises it), so it must not use anything from this module's scope: every helper is declared inside it.
 *
 * "Visible" means rendered: a box larger than 1 px (so the 1 px sr-only text is out), and checkVisibility() true (display,
 * visibility, opacity, closed <details>). "Above the fold" means some part of the box can be seen without scrolling: inside the
 * viewport and inside every scrolling or clipping ancestor (the app scrolls <main>, not the document).
 */

export interface Metrics {
  url: string
  title: string
  h1: string | null
  /** 'not-found' and 'no-access' are the app's own pages for a bad address or a role without access. */
  status: 'ok' | 'not-found' | 'no-access'
  viewport: { width: number; height: number }
  /** Height of the whole page if nothing scrolled inside it (document or <main>). */
  contentHeight: number
  /** Visible elements with role button or link. */
  actions: { total: number; aboveFold: number; buttons: number; links: number }
  /** Primary-variant buttons and links (class bg-primary, data-variant="primary" or the primary background colour). */
  primary: { inMain: number; inMainAboveFold: number; disabledInMain: number; inChrome: number; labels: string[] }
  /** Status chips and tags: StatusBadge ([data-status]) and any small bordered inline label. Header = the page title's block. */
  chips: { total: number; aboveFold: number; header: number; headerMethod: string; headerLabels: string[] }
  tables: { count: number; maxColumns: number; columns: number[] }
  words: { aboveFold: number; total: number }
  /** Characters of visible text by computed font size. */
  text: {
    chars: number
    under14: number
    from14to16: number
    atLeast16: number
    foldChars: number
    foldUnder14: number
    minPx: number | null
    /** Characters per rounded px size, e.g. {"13": 5120, "16": 830}. */
    sizes: Record<string, number>
  }
  hScroll: { page: boolean; main: boolean; overflowPx: number; offenders: string[] }
  /** Phones only (null on wider viewports): the smallest interactive box, and how many are under 44 and 24 px. Inline text links are left out (WCAG 2.5.8 exception). */
  tap: { checked: number; minPx: number | null; under44: number; under24: number; inlineLinks: number; worst: { label: string; w: number; h: number }[] } | null
  /** Navigation strips (nav landmarks and tab lists) visible above the fold, breadcrumbs and pagers left out. */
  nav: { levels: number; labels: string[] }
  /** Elements whose own text is cut off: wider (or taller) than their box with overflow hidden, clip or an ellipsis. */
  clipped: { count: number; ellipsis: number; samples: { text: string; axis: 'x' | 'y'; ellipsis: boolean }[] }
}

export function collect(opts: { phone: boolean }): Metrics {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const main = document.querySelector<HTMLElement>('#main')

  type Box = { l: number; t: number; r: number; b: number }
  const VIEW: Box = { l: 0, t: 0, r: vw, b: vh }
  const inter = (a: Box, b: Box): Box => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) })
  const boxOf = (r: DOMRect): Box => ({ l: r.left, t: r.top, r: r.right, b: r.bottom })
  const hasArea = (b: Box) => b.r - b.l > 1 && b.b - b.t > 1

  const styles = new Map<Element, CSSStyleDeclaration>()
  const style = (el: Element): CSSStyleDeclaration => {
    let s = styles.get(el)
    if (!s) {
      s = getComputedStyle(el)
      styles.set(el, s)
    }
    return s
  }
  const rects = new Map<Element, DOMRect>()
  const rect = (el: Element): DOMRect => {
    let r = rects.get(el)
    if (!r) {
      r = el.getBoundingClientRect()
      rects.set(el, r)
    }
    return r
  }
  const vis = new Map<Element, boolean>()
  const visible = (el: Element): boolean => {
    let v = vis.get(el)
    if (v === undefined) {
      const r = rect(el)
      const check = (el as HTMLElement & { checkVisibility?: (o: object) => boolean }).checkVisibility
      v = r.width > 1 && r.height > 1 && (check ? check.call(el, { opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true }) : true)
      vis.set(el, v)
    }
    return v
  }
  const clips = (el: Element) => {
    const s = style(el)
    return s.overflowX !== 'visible' || s.overflowY !== 'visible'
  }
  // The part of the screen where an element's own box can be seen; and the part where its children can.
  const regions = new Map<Element, Box>()
  const contentRegions = new Map<Element, Box>()
  const regionFor = (el: Element): Box => {
    const hit = regions.get(el)
    if (hit) return hit
    const p = el.parentElement
    let box: Box
    if (!p || p === document.body || p === document.documentElement || style(el).position === 'fixed') box = VIEW
    else box = contentRegionOf(p)
    regions.set(el, box)
    return box
  }
  const contentRegionOf = (el: Element): Box => {
    const hit = contentRegions.get(el)
    if (hit) return hit
    let box = regionFor(el)
    if (clips(el)) box = inter(box, boxOf(rect(el)))
    contentRegions.set(el, box)
    return box
  }
  const foldBox = (el: Element, r: DOMRect = rect(el)) => hasArea(inter(regionFor(el), boxOf(r)))
  const inFold = (el: Element) => foldBox(el)

  const ROLE_OF = (el: Element): string => {
    const explicit = el.getAttribute('role')
    if (explicit) return explicit
    if (el.tagName === 'BUTTON') return 'button'
    if (el.tagName === 'A' && el.hasAttribute('href')) return 'link'
    return ''
  }
  const label = (el: Element): string => {
    const raw = el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('title') || el.getAttribute('placeholder') || ''
    return raw.replace(/\s+/g, ' ').trim().slice(0, 60)
  }
  const describe = (el: Element): string => {
    const cls = typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : ''
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''} "${label(el).slice(0, 40)}"`
  }

  // ---------------------------------------------------------------- page status and title
  const h1s = Array.from(document.querySelectorAll('h1'))
  const h1 = h1s.find(h => main?.contains(h) && visible(h)) ?? h1s.find(h => visible(h)) ?? null
  const h1Text = (h1 ?? h1s[0])?.textContent?.replace(/\s+/g, ' ').trim() ?? null
  const status: Metrics['status'] = /page not found/i.test(h1Text ?? '') ? 'not-found' : /is for (admins|sales|engineers)|has no access/i.test(h1Text ?? '') ? 'no-access' : 'ok'

  // ---------------------------------------------------------------- text, words and sizes
  const text: Metrics['text'] = { chars: 0, under14: 0, from14to16: 0, atLeast16: 0, foldChars: 0, foldUnder14: 0, minPx: null, sizes: {} }
  const words = { aboveFold: 0, total: 0 }
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE'])
  const range = document.createRange()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const t = (node.nodeValue ?? '').replace(/\s+/g, ' ').trim()
    if (!t) continue
    const el = node.parentElement
    if (!el || SKIP.has(el.tagName) || el.closest('svg') || !visible(el)) continue
    range.selectNodeContents(node)
    const r = range.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const px = parseFloat(style(el).fontSize)
    const chars = t.replace(/\s/g, '').length
    const n = t.split(' ').filter(w => /[\p{L}\p{N}]/u.test(w)).length
    text.chars += chars
    words.total += n
    if (px < 13.95) text.under14 += chars
    else if (px < 15.95) text.from14to16 += chars
    else text.atLeast16 += chars
    const key = String(Math.round(px * 10) / 10)
    text.sizes[key] = (text.sizes[key] ?? 0) + chars
    text.minPx = text.minPx === null ? px : Math.min(text.minPx, px)
    if (foldBox(el, r)) {
      text.foldChars += chars
      if (px < 13.95) text.foldUnder14 += chars
      words.aboveFold += n
    }
  }

  // ---------------------------------------------------------------- actions and primary buttons
  const probe = document.createElement('div')
  probe.className = 'bg-primary'
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:4px;height:4px'
  document.body.appendChild(probe)
  const primaryBg = getComputedStyle(probe).backgroundColor
  probe.remove()
  const transparent = (c: string) => c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c)
  const isPrimary = (el: Element) => {
    const cls = typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className : ''
    return /(^|\s)bg-primary(\s|$)/.test(cls) || el.getAttribute('data-variant') === 'primary' || (!transparent(primaryBg) && style(el).backgroundColor === primaryBg)
  }
  const actions: Metrics['actions'] = { total: 0, aboveFold: 0, buttons: 0, links: 0 }
  const primary: Metrics['primary'] = { inMain: 0, inMainAboveFold: 0, disabledInMain: 0, inChrome: 0, labels: [] }
  for (const el of Array.from(document.querySelectorAll('button, a[href], [role="button"], [role="link"]'))) {
    const role = ROLE_OF(el)
    if ((role !== 'button' && role !== 'link') || !visible(el)) continue
    actions.total++
    if (role === 'button') actions.buttons++
    else actions.links++
    const fold = inFold(el)
    if (fold) actions.aboveFold++
    if (!isPrimary(el)) continue
    const inMain = Boolean(main?.contains(el))
    if (!inMain) {
      primary.inChrome++
      continue
    }
    primary.inMain++
    if (fold) primary.inMainAboveFold++
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') primary.disabledInMain++
    primary.labels.push(label(el))
  }

  // ---------------------------------------------------------------- chips
  const INTERACTIVE = /^(button|link|tab|radio|checkbox|switch|menuitem|option|combobox|img)$/
  const chipSet = new Set<Element>()
  const chipList: Element[] = []
  for (const el of Array.from(document.querySelectorAll('span, div, p, li, strong, b, small, em, mark, time, a'))) {
    if (el.tagName === 'KBD' || INTERACTIVE.test(ROLE_OF(el)) || !visible(el)) continue
    const s = style(el)
    const r = rect(el)
    const isBadge = el.hasAttribute('data-status') && r.height <= 32
    if (!isBadge) {
      if (!s.display.startsWith('inline')) continue
      if (r.height < 14 || r.height > 32) continue
      const bordered = ['Top', 'Right', 'Bottom', 'Left'].some(side => {
        const w = parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`))
        const st = s.getPropertyValue(`border-${side.toLowerCase()}-style`)
        const col = s.getPropertyValue(`border-${side.toLowerCase()}-color`)
        return w > 0 && st !== 'none' && !transparent(col)
      })
      if (!bordered || parseFloat(s.borderTopLeftRadius) <= 0) continue
    }
    const t = ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim()
    if (t.length < 1 || t.length > 48) continue
    if (el.querySelector('button, a[href], input, select, textarea, [role="button"]')) continue
    // count the outermost chip only
    let p = el.parentElement
    let nested = false
    while (p && p !== document.body) {
      if (chipSet.has(p)) {
        nested = true
        break
      }
      p = p.parentElement
    }
    if (nested) continue
    chipSet.add(el)
    chipList.push(el)
  }
  const chips: Metrics['chips'] = { total: chipList.length, aboveFold: chipList.filter(inFold).length, header: 0, headerMethod: 'none', headerLabels: [] }
  {
    let band: Box | null = null
    let container: Element | null = null
    if (h1 && visible(h1)) {
      const head = h1.closest('header')
      if (head && rect(head).height <= vh * 0.6 && !head.hasAttribute('data-mobile-bar')) {
        container = head
        band = boxOf(rect(head))
        chips.headerMethod = 'header element'
      } else {
        const r = rect(h1)
        band = { l: -1e6, r: 1e6, t: r.top - 16, b: r.bottom + 96 }
        chips.headerMethod = 'band under h1'
      }
    } else if (main) {
      const r = rect(main)
      band = { l: -1e6, r: 1e6, t: r.top, b: r.top + 160 }
      chips.headerMethod = 'top of main (no visible h1)'
    }
    if (band) {
      for (const el of chipList) {
        if (main && !main.contains(el)) continue
        if (container && !container.contains(el)) continue
        const r = rect(el)
        const cy = (r.top + r.bottom) / 2
        if (cy >= band.t && cy <= band.b) {
          chips.header++
          chips.headerLabels.push(label(el))
        }
      }
    }
  }

  // ---------------------------------------------------------------- tables
  const tables: Metrics['tables'] = { count: 0, maxColumns: 0, columns: [] }
  for (const t of Array.from(document.querySelectorAll('table, [role="table"], [role="grid"]'))) {
    if (!visible(t)) continue
    if (t.tagName !== 'TABLE' && t.querySelector('table')) continue
    let heads: Element[] = []
    if (t instanceof HTMLTableElement) {
      const rows = t.tHead ? Array.from(t.tHead.rows) : t.rows.length ? [t.rows[0]] : []
      const last = rows[rows.length - 1]
      heads = last ? Array.from(last.cells).filter(c => c.tagName === 'TH') : []
    } else {
      heads = Array.from(t.querySelectorAll('[role="columnheader"]'))
    }
    const n = heads.filter(h => visible(h)).length
    tables.count++
    tables.columns.push(n)
    tables.maxColumns = Math.max(tables.maxColumns, n)
  }

  // ---------------------------------------------------------------- horizontal scroll
  const se = document.scrollingElement ?? document.documentElement
  const pageOver = se.scrollWidth - se.clientWidth
  const mainOver = main && style(main).overflowX !== 'hidden' && style(main).overflowX !== 'clip' ? main.scrollWidth - main.clientWidth : 0
  const offenders: string[] = []
  if (pageOver > 1 || mainOver > 1) {
    const seen = new Set<Element>()
    for (const el of Array.from(document.querySelectorAll('#main *, body > *'))) {
      if (offenders.length >= 6) break
      const r = rect(el)
      if (r.right <= vw + 1 || !visible(el)) continue
      // inside its own horizontal scroller (a table wrapper, a tab strip): that one scrolls, not the page
      let p = el.parentElement
      let contained = false
      while (p && p !== main && p !== document.body) {
        const ox = style(p).overflowX
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') {
          contained = true
          break
        }
        p = p.parentElement
      }
      if (contained) continue
      let q = el.parentElement
      let reported = false
      while (q) {
        if (seen.has(q)) {
          reported = true
          break
        }
        q = q.parentElement
      }
      seen.add(el)
      if (!reported) offenders.push(`${describe(el)} right=${Math.round(r.right)}`)
    }
  }
  const hScroll = { page: pageOver > 1, main: mainOver > 1, overflowPx: Math.max(pageOver, mainOver, 0), offenders }

  // ---------------------------------------------------------------- tap targets (phones)
  let tap: Metrics['tap'] = null
  if (opts.phone) {
    tap = { checked: 0, minPx: null, under44: 0, under24: 0, inlineLinks: 0, worst: [] }
    const all: { label: string; w: number; h: number; size: number }[] = []
    const sel =
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="option"], [role="combobox"]'
    for (const el of Array.from(document.querySelectorAll(sel))) {
      if (!visible(el)) continue
      const r = rect(el)
      if (el.tagName === 'A' && style(el).display === 'inline') {
        const parentText = (el.parentElement?.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (parentText.length > (el.textContent ?? '').trim().length + 3) {
          tap.inlineLinks++
          continue
        }
      }
      // a native control drawn inside a bigger label (a checkbox row): the label is the target
      const lab = (el as HTMLInputElement).labels?.[0]
      const w = lab && visible(lab) ? Math.max(r.width, rect(lab).width) : r.width
      const h = lab && visible(lab) ? Math.max(r.height, rect(lab).height) : r.height
      const size = Math.min(w, h)
      tap.checked++
      all.push({ label: label(el) || describe(el), w: Math.round(w), h: Math.round(h), size })
      if (size < 43.5) tap.under44++
      if (size < 23.5) tap.under24++
      tap.minPx = tap.minPx === null ? Math.round(size) : Math.min(tap.minPx, Math.round(size))
    }
    tap.worst = all
      .sort((a, b) => a.size - b.size)
      .slice(0, 8)
      .map(({ label: l, w, h }) => ({ label: l, w, h }))
  }

  // ---------------------------------------------------------------- navigation strips
  const navEls: Element[] = []
  for (const el of Array.from(document.querySelectorAll('nav, [role="navigation"], [role="tablist"]'))) {
    if (!visible(el) || el.closest('[role="dialog"]') || !inFold(el)) continue
    const name = el.getAttribute('aria-label') ?? ''
    if (/breadcrumb|^pages$|pagination/i.test(name)) continue
    if (navEls.some(n => n.contains(el))) continue
    navEls.push(el)
  }
  const nav = { levels: navEls.length, labels: navEls.map(n => `${n.getAttribute('role') === 'tablist' ? 'tabs' : 'nav'}: ${n.getAttribute('aria-label') ?? label(n).slice(0, 30)}`) }

  // ---------------------------------------------------------------- clipped text
  const clipped: Metrics['clipped'] = { count: 0, ellipsis: 0, samples: [] }
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    if (!(el instanceof HTMLElement) || SKIP.has(el.tagName)) continue
    const ownText = Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE && (n.nodeValue ?? '').trim())
    if (!ownText || !visible(el)) continue
    const s = style(el)
    if (s.display.startsWith('inline') && s.display !== 'inline-block' && s.display !== 'inline-flex' && s.display !== 'inline-grid') continue
    const hidesX = s.overflowX === 'hidden' || s.overflowX === 'clip'
    const hidesY = s.overflowY === 'hidden' || s.overflowY === 'clip'
    const ellipsis = s.textOverflow === 'ellipsis'
    let axis: 'x' | 'y' | null = null
    if (hidesX && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) axis = 'x'
    else if (hidesY && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1 && rect(el).height > 2) axis = 'y'
    if (!axis) continue
    clipped.count++
    if (ellipsis) clipped.ellipsis++
    if (clipped.samples.length < 12) clipped.samples.push({ text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60), axis, ellipsis })
  }

  const contentHeight = Math.round(Math.max(se.scrollHeight, main ? main.scrollHeight + (vh - main.clientHeight) : 0))

  return {
    url: location.pathname + location.search,
    title: document.title,
    h1: h1Text,
    status,
    viewport: { width: vw, height: vh },
    contentHeight,
    actions,
    primary,
    chips,
    tables,
    words,
    text,
    hScroll,
    tap,
    nav,
    clipped,
  }
}
