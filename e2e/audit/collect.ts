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
  /** Visible elements with role button or link. mainAboveFold: those inside <main> that can be seen without scrolling. */
  actions: { total: number; aboveFold: number; buttons: number; links: number; mainAboveFold?: number; rowActionsAboveFold?: number; mainLabels?: string[] }
  /** The screen carries data-no-primary: it has no single next step, so zero green buttons is allowed (two or more never is). */
  noPrimary?: boolean
  /**
   * Primary-variant buttons and links (class bg-primary, data-variant="primary" or the primary background colour). inMain counts the
   * enabled ones in <main>; disabled ones (drawn grey) are counted in disabledInMain; the top bar's are inChrome.
   */
  primary: {
    inMain: number
    inMainAboveFold: number
    disabledInMain: number
    inChrome: number
    labels: string[]
    /**
     * Enabled green buttons anywhere a person sees them without scrolling: <main>, the top bar and the phone bars together (hidden
     * ones, and anything under an open dialog, left out). The rubric's "exactly one green main button" is this number.
     */
    onScreen: number
    /** The same, over the whole page (below the fold too). */
    anywhere: number
    /** Labels of the onScreen ones; the ones outside <main> end in "[bar]". */
    onScreenLabels: string[]
  }
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
  /**
   * Content that does not fit sideways. scrollers: elements (not <main>, not form fields) that scroll sideways on their own
   * (scrollWidth > clientWidth with overflow-x auto or scroll). cut: text nodes cut off by an overflow hidden/clip box with no
   * ellipsis (either axis; a line clamp counts as an ellipsis). offscreen: text and controls running past the viewport's right edge
   * while the page itself does not scroll sideways.
   */
  overflow: { scrollers: number; cut: number; offscreen: number; samples: { kind: 'scroller' | 'cut' | 'offscreen'; what: string }[] }
  /**
   * Text drawn over other text: two visible text lines on the same layer (the page, one dialog, one fixed bar) whose painted boxes
   * cross by more than 3 px each way and 15% of the smaller box (a key hint over a label, a reference over an item name).
   */
  overlap?: { count: number; samples: string[] }
  /** Boxes that scroll sideways inside the page (a filter strip, a table wrapper) because their content is wider than they are. */
  strips?: { count: number; samples: string[] }
  /**
   * Text on a highlighted background (selected row, hover row or table header, a tone tint) under its floor: 4.5:1 for a control's
   * label or a heading, 7:1 for everything else (rubric "Contrast"). Disabled controls are exempt.
   */
  contrastHi?: { checked: number; failing: number; samples: string[] }
  /** Phones only: visible text fields (input, textarea, select, editable box) whose text is under 16 px (iOS zooms on a tap). */
  inputs?: { checked: number; under16: number; samples: string[] } | null
  /**
   * Layout checks (docs/audit/SCREEN_AUDIT.md, "The layout gate"). docScroll is null where it does not apply (a dialog is open or
   * measured). The gate (scripts/audit/report.mjs --gate layout) fails on docScroll, nestedScroll, boxOverflow, labelTouchesControl
   * and hScroll; unevenWrap is advisory.
   */
  layout?: {
    docScroll: { count: number; docOverPx: number; scrolledPx: number; shellGapPx: number; samples: string[] } | null
    nestedScroll: { count: number; samples: string[] }
    boxOverflow: { count: number; samples: string[] }
    labelTouchesControl: { count: number; samples: string[] }
    unevenWrap: { count: number; samples: string[] }
  }
  /**
   * Clarity (docs/audit/SCREEN_AUDIT.md, "The clarity ratchet"). firstWorkY: top of the first visible [data-work] element in the page at
   * scroll 0 (null when there is none). boxDepth: the deepest chain of nested boxes (a box is a visible element in the page with a border
   * on 3 or more sides, a radius above 0 and 2000 px2 or more; controls, chips and inputs are not boxes). boxesAtFold: boxes in the first screen (top above the fold, bottom below 0)
   * stepRowMax: height of the tallest job step row (null when the page has none).
   * todoRowMax: height of the tallest visible To do row, a [data-block] li (null when the page has none).
   */
  clarity: { firstWorkY: number | null; boxDepth: number; boxesAtFold: number; stepRowMax: number | null; todoRowMax: number | null }
}

export interface CollectOptions {
  phone: boolean
  /** Measure inside this element instead of <main> (a dialog); everything outside it is treated as covered. */
  root?: string | null
}

export function collect(opts: CollectOptions): Metrics {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const rootEl = opts.root ? document.querySelector<HTMLElement>(opts.root) : null
  const main = rootEl ?? document.querySelector<HTMLElement>('#main')

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
  // Screen-reader-only content (Tailwind sr-only: clip rect(0 0 0 0), or clip-path inset(50%)) on the element or an ancestor. Its box
  // is not always 1 px: padding classes on the same element (the "Skip to content" link) make it bigger, but nothing is painted.
  const srOnly = new Map<Element, boolean>()
  const clippedAway = (el: Element | null): boolean => {
    if (!el || el === document.body || el === document.documentElement) return false
    let v = srOnly.get(el)
    if (v === undefined) {
      const s = style(el)
      const zeroClip = s.position !== 'static' && /^rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)$/.test(s.clip)
      v = zeroClip || s.clipPath === 'inset(50%)' || clippedAway(el.parentElement)
      srOnly.set(el, v)
    }
    return v
  }
  const vis = new Map<Element, boolean>()
  const visible = (el: Element): boolean => {
    let v = vis.get(el)
    if (v === undefined) {
      const r = rect(el)
      const check = (el as HTMLElement & { checkVisibility?: (o: object) => boolean }).checkVisibility
      v =
        r.width > 1 &&
        r.height > 1 &&
        (check ? check.call(el, { opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true }) : true) &&
        !clippedAway(el)
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

  // An open dialog (the measured root, else the last visible modal one) covers the rest of the screen: nothing outside it is
  // counted where "seen" matters (green buttons on screen, clipped, overlaps, overflow). A popover (also role dialog) does not.
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"]')).filter(d => visible(d))
  const topDialog: Element | null = rootEl ?? dialogs[dialogs.length - 1] ?? null
  const covered = (el: Element) => Boolean(topDialog && !topDialog.contains(el))

  // Where an element's children can paint: its ancestors' (and its own) overflow hidden/clip boxes, per axis. Scrolling boxes
  // (auto, scroll) are left out: their content is reachable. A fixed element escapes its ancestors' clips.
  const FAR: Box = { l: -1e9, t: -1e9, r: 1e9, b: 1e9 }
  const paintClips = new Map<Element, Box>()
  const paintClipOf = (el: Element | null): Box => {
    if (!el || el === document.body || el === document.documentElement) return FAR
    const hit = paintClips.get(el)
    if (hit) return hit
    const s = style(el)
    let box = s.position === 'fixed' ? FAR : paintClipOf(el.parentElement)
    const hx = s.overflowX === 'hidden' || s.overflowX === 'clip'
    const hy = s.overflowY === 'hidden' || s.overflowY === 'clip'
    if (hx || hy) {
      const r = rect(el)
      box = inter(box, { l: hx ? r.left : -1e9, r: hx ? r.right : 1e9, t: hy ? r.top : -1e9, b: hy ? r.bottom : 1e9 })
    }
    paintClips.set(el, box)
    return box
  }
  // The paint layer: the nearest fixed or sticky ancestor (a bar drawn over scrolled content is not a collision).
  const layers = new Map<Element, Element | null>()
  const layerOf = (el: Element | null): Element | null => {
    if (!el || el === document.body || el === document.documentElement) return null
    if (layers.has(el)) return layers.get(el) ?? null
    const p = style(el).position
    const v = p === 'fixed' || p === 'sticky' ? el : layerOf(el.parentElement)
    layers.set(el, v)
    return v
  }
  const short = (s: string, n = 28) => {
    const t = s.replace(/\s+/g, ' ').trim()
    return t.length > n ? `${t.slice(0, n - 3)}...` : t
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
  // Painted text boxes for the overlap and off-screen checks (one per line fragment of a text node).
  type TextBox = { node: number; el: Element; layer: Element | null; raw: Box; b: Box; text: string }
  const MAX_TEXT_BOXES = 6000
  const textBoxes: TextBox[] = []
  let nodeIndex = 0
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
    if (textBoxes.length < MAX_TEXT_BOXES && !covered(el)) {
      const clip = paintClipOf(el)
      const layer = layerOf(el)
      nodeIndex++
      for (const cr of Array.from(range.getClientRects())) {
        if (cr.width < 1 || cr.height < 1) continue
        const raw = boxOf(cr)
        const b = inter(clip, raw)
        if (hasArea(b)) textBoxes.push({ node: nodeIndex, el, layer, raw, b, text: t })
      }
    }
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
  const actions: Metrics['actions'] = { total: 0, aboveFold: 0, buttons: 0, links: 0, mainAboveFold: 0 }
  const primary: Metrics['primary'] = { inMain: 0, inMainAboveFold: 0, disabledInMain: 0, inChrome: 0, labels: [], onScreen: 0, anywhere: 0, onScreenLabels: [] }
  for (const el of Array.from(document.querySelectorAll('button, a[href], [role="button"], [role="link"]'))) {
    const role = ROLE_OF(el)
    if ((role !== 'button' && role !== 'link') || !visible(el)) continue
    actions.total++
    if (role === 'button') actions.buttons++
    else actions.links++
    const fold = inFold(el)
    // actions.aboveFold leaves out fold-row heads ([data-fold-row]) and per-row actions ([data-row-actions]): a list of rows is not a set of competing actions.
    if (fold && !el.closest('[data-fold-row], [data-row-actions]')) actions.aboveFold++
    // Not page-level actions, so left out of the 8-action target and counted apart: per-row actions of a list (a [data-row-actions]
    // container, any table row or column header, any list item), and navigation and choice controls (a nav landmark, tab list, [data-nav-strip], a button group such as a month pager, a toggle or radio), and the
    // (i) tips that explain a heading ([data-infotip]).
    if (fold && main?.contains(el)) {
      if (el.closest('[data-row-actions], tr, li, [role="row"], thead, nav, [role="tablist"], [role="group"], [role="radiogroup"], [data-nav-strip], [data-fold-row], [aria-pressed], [role="radio"], [data-infotip]')) actions.rowActionsAboveFold = (actions.rowActionsAboveFold ?? 0) + 1
      else {
        actions.mainAboveFold = (actions.mainAboveFold ?? 0) + 1
        if ((actions.mainLabels?.length ?? 0) < 30) (actions.mainLabels ??= []).push(label(el))
      }
    }
    if (!isPrimary(el)) continue
    const inMain = Boolean(main?.contains(el))
    const disabled = (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true'
    if (!disabled && !covered(el)) {
      primary.anywhere++
      if (fold) {
        primary.onScreen++
        primary.onScreenLabels.push(inMain ? label(el) : `${label(el)} [bar]`)
      }
    }
    if (!inMain) {
      // Behind an open modal dialog (the dialog is what is measured): not on screen, not a competing green.
      if (!covered(el)) primary.inChrome++
      continue
    }
    // A disabled primary is drawn grey (Button.tsx), so it is no competing green: counted apart, not in inMain.
    if (disabled) {
      primary.disabledInMain++
      primary.labels.push(`${label(el)} (disabled)`)
      continue
    }
    primary.inMain++
    if (fold) primary.inMainAboveFold++
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
    if (!ownText || covered(el) || !visible(el)) continue
    const s = style(el)
    if (s.display.startsWith('inline') && s.display !== 'inline-block' && s.display !== 'inline-flex' && s.display !== 'inline-grid') continue
    const hidesX = s.overflowX === 'hidden' || s.overflowX === 'clip'
    const hidesY = s.overflowY === 'hidden' || s.overflowY === 'clip'
    const ellipsis = s.textOverflow === 'ellipsis'
    let axis: 'x' | 'y' | null = null
    if (hidesX && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) axis = 'x'
    else if (hidesY && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1 && rect(el).height > 2) axis = 'y'
    if (!axis) continue
    // A deliberate line clamp (an ellipsis shows the cut, the whole text is in the title: a long item list in a windowed table) is a
    // shown cut, counted with the ellipses, as the "Text cut" check below does. A clamp without the whole text in a title still fails.
    const clamp = s.getPropertyValue('-webkit-line-clamp')
    const clamped = !!clamp && clamp !== 'none' && axis === 'y' && !!(el.getAttribute('title') ?? '').trim()
    if (clamped) {
      clipped.ellipsis++
      continue
    }
    clipped.count++
    if (ellipsis) clipped.ellipsis++
    if (clipped.samples.length < 12) clipped.samples.push({ text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60), axis, ellipsis })
  }

  // ---------------------------------------------------------------- text over text, highlighted-row contrast
  // A layer is what moves or sits together: a dialog, a popover, a fixed or sticky bar, or the page. Text on two layers may cross
  // (the page scrolls under a sticky bar); text on one layer must not.
  const LAYER = '[role="dialog"], [role="alertdialog"], [role="tooltip"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]'
  const lineLayers = new Map<Element, Element>()
  const lineLayerOf = (el: Element): Element => {
    const hit = lineLayers.get(el)
    if (hit) return hit
    let l: Element = document.body
    for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
      const pos = style(p).position
      if (p.matches(LAYER) || pos === 'fixed' || pos === 'sticky') {
        l = p
        break
      }
    }
    lineLayers.set(el, l)
    return l
  }
  const parseColour = (c: string): [number, number, number, number] | null => {
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(c)
    if (!m) return null
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
    return [Number(m[1]), Number(m[2]), Number(m[3]), a]
  }
  const lum = ([r, g, b]: number[]) => {
    const f = (v: number) => {
      const x = v / 255
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ratio = (a: number[], b: number[]) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }
  // The highlighted backgrounds, read from the app's own classes so a token change is followed.
  const HIGHLIGHT_CLASSES = ['bg-selected', 'bg-sunken', 'bg-tone-neutral-bg', 'bg-tone-info-bg', 'bg-tone-success-bg', 'bg-tone-warning-bg', 'bg-tone-danger-bg', 'bg-block-late', 'bg-block-today', 'bg-block-week', 'bg-chrome']
  const highlight = new Map<string, string>()
  for (const cls of HIGHLIGHT_CLASSES) {
    const p = document.createElement('div')
    p.className = cls
    p.style.cssText = 'position:absolute;left:-9999px;top:0;width:4px;height:4px'
    document.body.appendChild(p)
    const bg = getComputedStyle(p).backgroundColor
    p.remove()
    if (!transparent(bg) && !highlight.has(bg)) highlight.set(bg, cls.slice(3))
  }
  const bgOf = new Map<Element, string | null>()
  const backgroundOf = (el: Element | null): string | null => {
    if (!el || el === document.documentElement) return null
    const hit = bgOf.get(el)
    if (hit !== undefined) return hit
    const c = style(el).backgroundColor
    const col = parseColour(c)
    const v = col && col[3] >= 0.95 ? c : backgroundOf(el.parentElement)
    bgOf.set(el, v)
    return v
  }
  const LABEL_LIKE = 'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="radio"], [role="checkbox"], [role="switch"], label, h1, h2, h3, h4, th, [role="columnheader"]'
  type Line = { el: Element; layer: Element; b: Box; text: string }
  const lines: Line[] = []
  const contrastHi = { checked: 0, failing: 0, samples: [] as string[] }
  const failedEls = new Set<Element>()
  const walker2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker2.nextNode(); node; node = walker2.nextNode()) {
    const t = (node.nodeValue ?? '').replace(/\s+/g, ' ').trim()
    if (!t || !/[\p{L}\p{N}]/u.test(t)) continue
    const el = node.parentElement
    if (!el || SKIP.has(el.tagName) || el.closest('svg') || !visible(el)) continue
    range.selectNodeContents(node)
    const seenBox = contentRegionOf(el)
    for (const r of Array.from(range.getClientRects())) {
      const b = inter(boxOf(r), seenBox)
      if (b.r - b.l > 1 && b.b - b.t > 1) lines.push({ el, layer: lineLayerOf(el), b, text: t })
    }
    // contrast on a highlighted background
    const bg = backgroundOf(el)
    if (!bg || !highlight.has(bg) || failedEls.has(el)) continue
    if (el.closest(':disabled, [aria-disabled="true"], [data-disabled]')) continue
    const fg = parseColour(style(el).color)
    const bgc = parseColour(bg)
    if (!fg || !bgc) continue
    const a = fg[3]
    const painted = [0, 1, 2].map(i => fg[i] * a + bgc[i] * (1 - a))
    const need = el.closest(LABEL_LIKE) ? 4.5 : 7
    const got = ratio(painted, bgc)
    // Text drawn in its own background colour is hidden on purpose (a column name kept for screen readers): not low contrast.
    if (got < 1.1) continue
    contrastHi.checked++
    if (got + 0.005 < need) {
      failedEls.add(el)
      contrastHi.failing++
      if (contrastHi.samples.length < 8) contrastHi.samples.push(`"${t.slice(0, 30)}" ${got.toFixed(2)}:1 on ${highlight.get(bg)} (needs ${need}:1)`)
    }
  }
  const overlap = { count: 0, samples: [] as string[] }
  {
    const sorted = lines.sort((p, q) => p.b.t - q.b.t)
    const reported = new Set<string>()
    for (let i = 0; i < sorted.length; i++) {
      const A = sorted[i]
      for (let j = i + 1; j < sorted.length; j++) {
        const B = sorted[j]
        if (B.b.t >= A.b.b) break
        if (A.el === B.el || A.layer !== B.layer) continue
        const w = Math.min(A.b.r, B.b.r) - Math.max(A.b.l, B.b.l)
        const h = Math.min(A.b.b, B.b.b) - Math.max(A.b.t, B.b.t)
        if (w <= 3 || h <= 3) continue
        const small = Math.min((A.b.r - A.b.l) * (A.b.b - A.b.t), (B.b.r - B.b.l) * (B.b.b - B.b.t))
        if (w * h < 0.15 * small) continue
        const key = [A.text, B.text].sort().join('|')
        if (reported.has(key)) continue
        reported.add(key)
        overlap.count++
        if (overlap.samples.length < 8) overlap.samples.push(`"${A.text.slice(0, 30)}" over "${B.text.slice(0, 30)}"`)
      }
    }
  }

  // ---------------------------------------------------------------- sideways overflow inside the page
  const overflow: Metrics['overflow'] = { scrollers: 0, cut: 0, offscreen: 0, samples: [] }
  {
    const perKind = { scroller: 0, cut: 0, offscreen: 0 }
    const sample = (kind: keyof typeof perKind, what: string) => {
      if (perKind[kind]++ < 4) overflow.samples.push({ kind, what })
    }
    const FIELDS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'])
    const cutNodes = new Set<Text>()
    const shellMain = document.querySelector('#main')
    const textWalk = document.createRange()
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (!(el instanceof HTMLElement) || SKIP.has(el.tagName) || FIELDS.has(el.tagName) || el.closest('svg')) continue
      if (el === main || el === shellMain || covered(el)) continue
      const overX = el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1
      const overY = el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1
      if (!overX && !overY) continue
      if (!visible(el)) continue
      const s = style(el)
      if (overX && (s.overflowX === 'auto' || s.overflowX === 'scroll')) {
        overflow.scrollers++
        sample('scroller', `${describe(el)} +${el.scrollWidth - el.clientWidth}px`)
      }
      const hidesX = overX && (s.overflowX === 'hidden' || s.overflowX === 'clip') && s.textOverflow !== 'ellipsis'
      const clamp = s.getPropertyValue('-webkit-line-clamp')
      const hidesY = overY && (s.overflowY === 'hidden' || s.overflowY === 'clip') && (!clamp || clamp === 'none') && rect(el).height > 8
      if (!hidesX && !hidesY) continue
      // Which text actually runs past the box (the overflow may be an icon or a shadow): each text node counted once.
      const r = rect(el)
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
        if (cutNodes.has(n) || !(n.nodeValue ?? '').trim() || !n.parentElement || !visible(n.parentElement)) continue
        if (n.parentElement.closest('svg')) continue
        // An ellipsis on the text's own box means the cut is shown.
        if (style(n.parentElement).textOverflow === 'ellipsis') continue
        // Inside a line clamp (a "first 3 lines" preview with "Show the whole message"): the cut is shown with an ellipsis.
        let clamped = false
        for (let p: Element | null = n.parentElement; p && p !== el.parentElement; p = p.parentElement) {
          const lc = style(p).getPropertyValue('-webkit-line-clamp')
          if (lc && lc !== 'none') {
            clamped = true
            break
          }
        }
        if (clamped) continue
        textWalk.selectNodeContents(n)
        // Down, a glyph box may stick out of a tight line box by a few px without anything being lost.
        const out = Array.from(textWalk.getClientRects()).some(t => {
          if (t.width < 1) return false
          const slackY = Math.max(3, 0.3 * t.height)
          return (hidesX && (t.right > r.right + 1 || t.left < r.left - 1)) || (hidesY && (t.bottom > r.bottom + slackY || t.top < r.top - slackY))
        })
        if (!out) continue
        cutNodes.add(n)
        overflow.cut++
        sample('cut', `"${short(n.nodeValue ?? '', 40)}" in ${describe(el).split(' ')[0]}`)
      }
    }
    // Past the right edge of the viewport while the page itself does not scroll sideways (pageOver is measured above).
    if (pageOver <= 1) {
      const reported = new Set<Element>()
      for (const tb of textBoxes) {
        if (tb.raw.r > vw + 1 && tb.raw.l < vw - 1 && tb.b.r > vw + 1 && !reported.has(tb.el)) {
          reported.add(tb.el)
          overflow.offscreen++
          sample('offscreen', `"${short(tb.text)}" right=${Math.round(tb.raw.r)}`)
        }
      }
      const controls = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="tab"], [role="combobox"], [role="searchbox"]'
      for (const el of Array.from(document.querySelectorAll(controls))) {
        if (covered(el) || !visible(el) || reported.has(el)) continue
        const r = rect(el)
        if (r.right <= vw + 1 || r.left >= vw - 1 || paintClipOf(el.parentElement).r <= vw + 1) continue
        if (Array.from(reported).some(p => p.contains(el) || el.contains(p))) continue
        reported.add(el)
        overflow.offscreen++
        sample('offscreen', `${describe(el)} right=${Math.round(r.right)}`)
      }
    }
  }

  // ---------------------------------------------------------------- boxes that scroll sideways inside the page
  const strips = { count: 0, samples: [] as string[] }
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    if (el === main || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'PRE') continue
    const ox = style(el).overflowX
    if (ox !== 'auto' && ox !== 'scroll') continue
    if (el.clientWidth <= 0 || el.scrollWidth <= el.clientWidth + 1 || !visible(el)) continue
    strips.count++
    const kind = el.querySelector('table, [role="table"], [role="grid"]') ? 'table' : el.matches('[role="tablist"], [role="radiogroup"]') || el.querySelector('[role="tab"], [role="radio"]') ? 'strip' : 'box'
    if (strips.samples.length < 6) strips.samples.push(`${kind}: ${describe(el)} ${el.scrollWidth}>${el.clientWidth}px`)
  }

  // ---------------------------------------------------------------- phone text fields under 16 px
  let inputs: Metrics['inputs'] = null
  if (opts.phone) {
    inputs = { checked: 0, under16: 0, samples: [] }
    const sel =
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]), textarea, select, [contenteditable="true"], [contenteditable=""]'
    for (const el of Array.from(document.querySelectorAll(sel))) {
      if (!visible(el)) continue
      inputs.checked++
      const px = parseFloat(style(el).fontSize)
      if (px < 15.95) {
        inputs.under16++
        if (inputs.samples.length < 6) inputs.samples.push(`${describe(el)} ${px}px`)
      }
    }
  }

  // ---------------------------------------------------------------- layout checks (the gate)
  const layout: NonNullable<Metrics['layout']> = {
    docScroll: null,
    nestedScroll: { count: 0, samples: [] },
    boxOverflow: { count: 0, samples: [] },
    labelTouchesControl: { count: 0, samples: [] },
    unevenWrap: { count: 0, samples: [] },
  }
  {
    const shellMain = document.querySelector<HTMLElement>('#main')
    const keepY = shellMain?.scrollTop ?? 0
    // Every layout number is taken with the document at the top.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
    const POPOVER = '[role="menu"], [role="listbox"], [role="tooltip"], [data-radix-popper-content-wrapper]'
    const pos = (el: Element) => style(el).position

    // docScroll: the document must never scroll; the app scrolls <main> only.
    if (!rootEl && dialogs.length === 0 && shellMain) {
      const docOverPx = Math.max(0, Math.round(se.scrollHeight - window.innerHeight))
      window.scrollTo({ top: 1e6, left: 0, behavior: 'instant' as ScrollBehavior })
      const scrolledPx = Math.round(window.scrollY)
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
      const shell = shellMain.parentElement
      const shellGapPx = shell ? Math.round(Math.abs(shell.getBoundingClientRect().bottom - window.innerHeight)) : 0
      const samples: string[] = []
      if (docOverPx > 1) samples.push(`document is ${docOverPx}px taller than the window`)
      if (scrolledPx > 0) samples.push(`window scrolls ${scrolledPx}px`)
      if (shellGapPx > 1) samples.push(`shell bottom is ${shellGapPx}px off the window bottom`)
      // What sticks out past the bottom edge: the likely cause. Absolute boxes (a screen-reader-only radio, an icon) whose nearest positioned
      // ancestor is the page, not <main>, are placed in window coordinates and stretch the document: hidden ones count too.
      if (samples.length) {
        let n = 0
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          if (n >= 4) break
          if (pos(el) !== 'absolute' || el.closest('svg') && el.tagName !== 'svg') continue
          const r = rect(el)
          if (r.bottom <= window.innerHeight + 1 || r.width <= 0 || paintClipOf(el).b <= window.innerHeight + 1) continue
          let fixedAbove = false
          for (let q = el.parentElement; q; q = q.parentElement) if (pos(q) === 'fixed') fixedAbove = true
          if (fixedAbove) continue
          n++
          samples.push(`absolute past the bottom: ${describe(el)} bottom=${Math.round(r.bottom)}, positioned against ${(el as HTMLElement).offsetParent ? describe((el as HTMLElement).offsetParent as Element).split(' ')[0] : 'the page'}`)
        }
        for (const el of Array.from(document.body.children)) {
          if (samples.length >= 8) break
          const r = rect(el)
          if (visible(el) && r.bottom > window.innerHeight + 1) samples.push(`body child past the bottom: ${describe(el)} bottom=${Math.round(r.bottom)}`)
        }
      }
      layout.docScroll = { count: (docOverPx > 1 ? 1 : 0) + (scrolledPx > 0 ? 1 : 0) + (shellGapPx > 1 ? 1 : 0), docOverPx, scrolledPx, shellGapPx, samples }
    }

    // nestedScroll: a box that scrolls up and down on its own inside <main> or a dialog: the person meets two scrollbars.
    // Left out: <main> itself, virtual lists, <pre>, text areas, selects, list boxes and popovers, [data-scroll-ok], Today's panes (they
    // scroll on purpose) and a dialog's own body (the outermost scroller in a dialog taller than the window).
    {
      const isToday = location.pathname === '/todo' || location.pathname.startsWith('/todo/')
      const scope: Element[] = rootEl ? [rootEl] : [...(main ? [main] : []), ...dialogs]
      const seen = new Set<Element>()
      for (const top of scope) {
        const isDialog = top.matches('[role="dialog"], [role="alertdialog"]')
        for (const el of Array.from(top.querySelectorAll('*'))) {
          if (seen.has(el) || el === main || !(el instanceof HTMLElement) || SKIP.has(el.tagName)) continue
          seen.add(el)
          const s = style(el)
          const scrollsY = (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1
          // Sideways inside a dialog is never meant (on the page a table wrapper may scroll sideways: that is the phone "strips" target).
          const scrollsX = isDialog && (s.overflowX === 'auto' || s.overflowX === 'scroll') && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1
          if ((!scrollsY && !scrollsX) || !visible(el)) continue
          if (el.matches('pre, textarea, select, [data-virtual], [data-scroll-ok]') || el.closest(`[data-virtual], [data-scroll-ok], pre, ${POPOVER}`)) continue
          if (scrollsX) {
            layout.nestedScroll.count++
            if (layout.nestedScroll.samples.length < 8) layout.nestedScroll.samples.push(`${describe(el)} scrolls sideways ${el.scrollWidth - el.clientWidth}px inside a dialog`)
            continue
          }
          if (isToday) continue
          if (isDialog) {
            let inner = false
            for (let p = el.parentElement; p && p !== top; p = p.parentElement) {
              const oy = style(p).overflowY
              if (oy === 'auto' || oy === 'scroll') inner = true
            }
            if (!inner) continue
          }
          layout.nestedScroll.count++
          if (layout.nestedScroll.samples.length < 8) layout.nestedScroll.samples.push(`${describe(el)} scrolls ${el.scrollHeight - el.clientHeight}px inside ${isDialog ? 'a dialog' : 'the page'}`)
        }
      }
    }

    // boxOverflow: a box that lets its content show (overflow visible) but is shorter than the content: text hangs out of its bottom.
    {
      const found: { el: Element; what: string }[] = []
      const tr = document.createRange()
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        if (!(el instanceof HTMLElement) || SKIP.has(el.tagName) || el.closest('svg') || covered(el)) continue
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') continue
        const s = style(el)
        if (s.overflowY !== 'visible' || s.overflowX !== 'visible' || s.display === 'contents' || s.display === 'inline') continue
        const overY = el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1
        const overX = el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1
        if ((!overY && !overX) || !visible(el)) continue
        const r = rect(el)
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        let hit: string | null = null
        for (let n = w.nextNode() as Text | null; n && !hit; n = w.nextNode() as Text | null) {
          const t = (n.nodeValue ?? '').replace(/\s+/g, ' ').trim()
          const pe = n.parentElement
          if (!t || !pe || !visible(pe) || pe.closest('svg')) continue
          // Only text that flows in this box: nothing positioned out of it, held by a closer box, or scrolling on its own.
          let flows = true
          for (let p: Element | null = pe; p && p !== el; p = p.parentElement) {
            const ps = style(p)
            if (ps.position === 'absolute' || ps.position === 'fixed' || ps.position === 'sticky' || ps.overflowY !== 'visible' || ps.overflowX !== 'visible') {
              flows = false
              break
            }
          }
          if (!flows) continue
          tr.selectNodeContents(n)
          const qs = Array.from(tr.getClientRects()).filter(q => q.width >= 1)
          const past = overY ? qs.reduce((m, q) => Math.max(m, q.bottom - r.bottom), -1e9) : -1e9
          // Sideways: a word wider than its column (a heading running into the next one). Fields with a scrollbar and a nowrap strip are left out above.
          const side = overX ? qs.reduce((m, q) => Math.max(m, q.right - r.right, r.left - q.left), -1e9) : -1e9
          if (past > 2) hit = `"${short(t, 40)}" hangs ${Math.round(past)}px below ${describe(el).split(' ')[0]} (box ${Math.round(r.height)}px, content ${el.scrollHeight}px)`
          else if (side > 1.5) hit = `"${short(t, 40)}" runs ${Math.round(side)}px sideways out of ${describe(el).split(' ')[0]} (box ${Math.round(r.width)}px wide, content ${el.scrollWidth}px)`
        }
        if (hit) found.push({ el, what: hit })
      }
      // The innermost box is the cause; ancestors that merely contain it are not listed again.
      const inner = found.filter(f => !found.some(g => g !== f && f.el.contains(g.el)))
      layout.boxOverflow.count = inner.length
      for (const f of inner.slice(0, 8)) layout.boxOverflow.samples.push(f.what)
    }

    // labelTouchesControl: text drawn over, or touching the top of, an input, select or button that is not its own.
    {
      // The scroll area an element moves with: its nearest scrolling ancestor (a fixed element is its own). The shell is not fixed:
      // <main> scrolls between the top bar, the bottom tabs and the Engineer button, which stay put. Content of <main> that sits
      // below the fold is never drawn on those bars, so text and a control that do not scroll together are not compared.
      // Both inside the same scroll area (or both outside any) are compared in full, below the fold included.
      const scrollAreaOf = (el: Element): Element | null => {
        for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
          const s = style(p)
          if (s.position === 'fixed') return p
          if (s.overflowY === 'auto' || s.overflowY === 'scroll') return p
        }
        return null
      }
      // The (i) button is 44px on a touch screen around a 24px footprint (negative margin), so its padding overlaps the heading by
      // design. Compare the footprint the eye sees.
      const seenBox = (c: HTMLElement): Box => {
        const r = rect(c)
        if (c.hasAttribute('data-infotip') && r.width > 24 && r.height > 24) {
          const cx = (r.left + r.right) / 2
          const cy = (r.top + r.bottom) / 2
          return { l: cx - 12, r: cx + 12, t: cy - 12, b: cy + 12 }
        }
        return boxOf(r)
      }
      const controls = Array.from(document.querySelectorAll<HTMLElement>('input:not([type="hidden"]), select, textarea, button')).filter(c => !covered(c) && visible(c) && rect(c).height >= 8 && rect(c).width >= 8)
      const reported = new Set<string>()
      for (const tb0 of textBoxes) {
        const te = tb0.el as HTMLElement
        const tb = tb0
        const teArea = scrollAreaOf(te)
        if (style(te).pointerEvents === 'none' || te.closest('[role="status"], [role="alert"], [data-sonner-toast], [aria-hidden="true"], button, input, select, textarea, [role="button"], [role="combobox"], [role="tab"], [role="option"], [role="menuitem"]')) continue
        if (tb.layer && pos(tb.layer) === 'fixed') continue
        // Painted off the screen sideways or above the page (a hidden panel parked at a negative offset): nothing is seen to touch.
        if (tb.b.r <= 0 || tb.b.l >= window.innerWidth || tb.b.b <= 0) continue
        for (const c of controls) {
          if (scrollAreaOf(c) !== teArea) continue
          const cb = seenBox(c)
          const cr = { left: cb.l, right: cb.r, top: cb.t, bottom: cb.b, width: cb.r - cb.l, height: cb.b - cb.t }
          const hOver = Math.min(tb.b.r, cr.right) - Math.max(tb.b.l, cr.left)
          if (hOver <= 1) continue
          if (cr.right <= 0 || cr.left >= window.innerWidth || cr.bottom <= 0) continue
          // A control on a fixed or sticky layer (bottom tabs, a sticky action bar, the top bar, a toast) is drawn over the page by design:
          // text on another layer (scrolled under it) is not a collision. Text and control on the same layer still are.
          if (layerOf(c) !== tb.layer) continue
          // text above or inside the control, never below it
          if (!(tb.b.b > cr.top - 1 && tb.b.t < cr.bottom - 1)) continue
          if (c.contains(te) || te.contains(c)) continue
          // A small button that sits beside the text (the "i" next to a title) and only grazes its line box: not a label over a field.
          const vOver = Math.min(tb.b.b, cr.bottom) - Math.max(tb.b.t, cr.top)
          if (cr.width <= 48 && cr.height <= 48 && hOver <= 8 && vOver <= 8) continue
          const lab = te.closest('label')
          if (lab && (lab.control === c || lab.contains(c))) continue
          // an adornment drawn on purpose over the field (a unit inside the box): positioned, between the text and the common ancestor
          let adorned = false
          for (let p: Element | null = te; p && !p.contains(c); p = p.parentElement) {
            const ps = pos(p)
            if (ps === 'absolute' || ps === 'fixed') adorned = true
          }
          if (adorned || te.closest('[role="dialog"]') !== c.closest('[role="dialog"]')) continue
          const key = `${tb.text}|${describe(c)}`
          if (reported.has(key)) continue
          reported.add(key)
          layout.labelTouchesControl.count++
          if (layout.labelTouchesControl.samples.length < 8) layout.labelTouchesControl.samples.push(`"${short(tb.text, 36)}" (bottom ${Math.round(tb.b.b)}) over ${describe(c)} (top ${Math.round(cr.top)})`)
        }
      }
    }

    // unevenWrap (advisory): a label of three words or fewer wraps onto two lines while its row-mates stay on one.
    {
      const lr = document.createRange()
      const lineCount = (n: Text) => {
        const tops: number[] = []
        lr.selectNodeContents(n)
        for (const q of Array.from(lr.getClientRects())) if (q.width >= 1 && !tops.some(t => Math.abs(t - q.top) < q.height * 0.6)) tops.push(q.top)
        return tops.length
      }
      const ownText = (e: Element) => Array.from(e.childNodes).find(n => n.nodeType === Node.TEXT_NODE && (n.nodeValue ?? '').trim()) as Text | undefined
      const reported = new Set<Element>()
      for (const tb of textBoxes) {
        const el = tb.el as HTMLElement
        if (reported.has(el) || covered(el)) continue
        if (tb.text.split(' ').filter(Boolean).length > 3) continue
        const node = ownText(el)
        if (!node || lineCount(node) < 2) continue
        const parent = el.parentElement
        if (!parent || !/flex|grid/.test(style(parent).display)) continue
        const er = rect(el)
        const mates = Array.from(parent.children).filter(sib => {
          if (sib === el || !visible(sib)) return false
          const sr = rect(sib)
          const own = ownText(sib)
          return Boolean(own) && sr.top < er.bottom && sr.bottom > er.top && lineCount(own as Text) === 1
        })
        if (!mates.length) continue
        reported.add(el)
        layout.unevenWrap.count++
        if (layout.unevenWrap.samples.length < 8) layout.unevenWrap.samples.push(`"${short(tb.text, 30)}" wraps, beside ${mates.length} one-line`)
      }
    }
    if (shellMain) shellMain.scrollTop = keepY
  }

  // ---------------------------------------------------------------- clarity
  const clarity: Metrics['clarity'] = { firstWorkY: null, boxDepth: 0, boxesAtFold: 0, stepRowMax: null, todoRowMax: null }
  if (main) {
    const scrolledY = (document.querySelector<HTMLElement>('#main')?.scrollTop ?? 0) + window.scrollY
    const work = Array.from(main.querySelectorAll<HTMLElement>('[data-work]')).find(visible)
    if (work) clarity.firstWorkY = Math.round(rect(work).top + scrolledY)
    const isControl = (el: Element) =>
      Boolean(el.closest('button, a, input, select, textarea, label, [role="button"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="option"], [role="menuitem"], [data-status], [data-infotip]'))
    const drawn = (c: string) => !transparent(c)
    const sideDrawn = (s: CSSStyleDeclaration, side: 'Top' | 'Right' | 'Bottom' | 'Left') =>
      parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 &&
      s.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none' &&
      drawn(s.getPropertyValue(`border-${side.toLowerCase()}-color`))
    const depthOf = new Map<Element, number>()
    for (const el of Array.from(main.querySelectorAll('*'))) {
      if (!visible(el) || isControl(el)) continue
      const r = rect(el)
      if (r.width * r.height < 2000) continue
      const s = style(el)
      if (!(parseFloat(s.borderTopLeftRadius) > 0 || parseFloat(s.borderTopRightRadius) > 0 || parseFloat(s.borderBottomLeftRadius) > 0 || parseFloat(s.borderBottomRightRadius) > 0)) continue
      if ((['Top', 'Right', 'Bottom', 'Left'] as const).filter(side => sideDrawn(s, side)).length < 3) continue
      let up = 0
      for (let p = el.parentElement; p && p !== main.parentElement; p = p.parentElement) {
        const d = depthOf.get(p)
        if (d) {
          up = d
          break
        }
      }
      depthOf.set(el, up + 1)
      clarity.boxDepth = Math.max(clarity.boxDepth, up + 1)
      if (r.top < vh && r.bottom > 0) clarity.boxesAtFold++
    }
    const rows = Array.from(main.querySelectorAll<HTMLElement>('[data-stages] [data-fold-row] > button'))
    const stepRows = (rows.length ? rows : Array.from(main.querySelectorAll<HTMLElement>('[data-stage] h2 button'))).filter(visible)
    if (stepRows.length) clarity.stepRowMax = Math.round(Math.max(...stepRows.map(b => rect(b).height)))
    const todoRows = Array.from(main.querySelectorAll<HTMLElement>('[data-block] li')).filter(visible)
    if (todoRows.length) clarity.todoRowMax = Math.round(Math.max(...todoRows.map(li => rect(li).height)))
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
    noPrimary: Boolean(main?.querySelector('[data-no-primary]') || main?.matches('[data-no-primary]')),
    primary,
    chips,
    tables,
    words,
    text,
    hScroll,
    tap,
    nav,
    clipped,
    overlap,
    overflow,
    strips,
    contrastHi,
    inputs,
    layout,
    clarity,
  }
}
