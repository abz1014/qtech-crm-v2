import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

/*
 * Maps docs/design/tokens.css (copied into src/index.css) onto Tailwind. Every
 * value is a var(--token): this file restates no colour, size or shadow, and
 * scripts/check-token-parity.mjs fails CI if it does. The theme is replaced, not
 * extended, for colour, spacing, radius, shadow, weight and type size, so a
 * class that is not a token does not exist (DESIGN_SYSTEM 14).
 * Neutral primitives (--neutral-*) are deliberately not exposed: components use
 * the semantic names below.
 */
const v = (name: string) => `var(--${name})`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      canvas: v('bg-canvas'),
      surface: v('bg-surface'),
      // Navy chrome: the top bar, the phone bars, the next-step band. Inside, set data-surface="navy" so primitives re-ink.
      chrome: { DEFAULT: v('bg-chrome'), fg: v('fg-on-chrome'), 'fg-2': v('fg-on-chrome-2'), field: v('chrome-field'), edge: v('chrome-input') },
      sunken: v('bg-sunken'),
      selected: v('bg-selected'),
      scrim: v('bg-scrim'),
      fg: { DEFAULT: v('fg'), 2: v('fg-2'), muted: v('fg-muted'), disabled: v('fg-disabled') },
      line: { DEFAULT: v('border'), strong: v('border-strong'), input: v('border-input') },
      primary: {
        DEFAULT: v('primary'),
        hover: v('primary-hover'),
        active: v('primary-active'),
        foreground: v('on-primary'),
      },
      // Non-text green only: focus ring, active indicator, progress, logo.
      'brand-green': v('brand-green'),
      tone: {
        'neutral-fg': v('tone-neutral-fg'),
        'neutral-bg': v('tone-neutral-bg'),
        'info-fg': v('tone-info-fg'),
        'info-bg': v('tone-info-bg'),
        'success-fg': v('tone-success-fg'),
        'success-bg': v('tone-success-bg'),
        'warning-fg': v('tone-warning-fg'),
        'warning-bg': v('tone-warning-bg'),
        'danger-fg': v('tone-danger-fg'),
        'danger-bg': v('tone-danger-bg'),
        'ink-fg': v('tone-ink-fg'),
        'ink-bg': v('tone-ink-bg'),
      },
      // Colour blocks (direction C): the To do groups. Late is red, Today yellow, This week blue; quiet for the rest.
      block: {
        late: v('block-late-bg'),
        'late-fg': v('block-late-fg'),
        today: v('block-today-bg'),
        'today-fg': v('block-today-fg'),
        week: v('block-week-bg'),
        'week-fg': v('block-week-fg'),
        quiet: v('block-quiet-bg'),
        'quiet-fg': v('block-quiet-fg'),
      },
      // Read by [data-status="group:value"] (set in tokens.css).
      status: { fg: v('status-fg'), bg: v('status-bg') },
    },
    borderColor: ({ theme }) => ({ ...theme('colors'), DEFAULT: v('border') }),
    // Green TEXT reads --primary-text (darker than the button fill), so a link keeps 5:1+ on a selected row or a tint.
    // text-primary-foreground (white on a green button) is unchanged.
    textColor: ({ theme }) => ({
      ...theme('colors'),
      primary: { DEFAULT: v('primary-text'), hover: v('primary-active'), active: v('primary-active'), foreground: v('on-primary') },
    }),
    spacing: {
      0: '0px',
      px: 'var(--hairline)',
      1: v('sp-1'),
      2: v('sp-2'),
      3: v('sp-3'),
      4: v('sp-4'),
      5: v('sp-5'),
      6: v('sp-6'),
      8: v('sp-8'),
      10: v('sp-10'),
      12: v('sp-12'),
      16: v('sp-16'),
    },
    // Radius ladder (direction C): controls 10, rows drawn as tiles 12, panels and blocks 16, tags and counts fully round.
    borderRadius: { none: '0px', DEFAULT: v('radius'), row: v('radius-row'), panel: v('radius-panel'), round: v('radius-round') },
    borderWidth: { DEFAULT: v('hairline'), 0: '0px', 2: v('focus-width') },
    boxShadow: { none: 'none', pop: v('shadow-pop'), modal: v('shadow-modal'), 'on-navy': v('shadow-on-navy') },
    // display: Archivo Wide (118 %), for page titles and block headings; h1 to h3 take it by default (src/index.css).
    fontFamily: { sans: v('font-sans'), display: v('font-display'), mono: v('font-mono') },
    fontSize: {
      // 14 px, timestamps only. Everything else read is 16 px or more (xs, sm and base are all 16).
      stamp: [v('text-stamp'), v('lh-stamp')],
      xs: [v('text-xs'), v('lh-xs')],
      sm: [v('text-sm'), v('lh-sm')],
      base: [v('text-base'), v('lh-base')],
      lg: [v('text-lg'), v('lh-lg')],
      xl: [v('text-xl'), v('lh-xl')],
      '2xl': [v('text-2xl'), v('lh-2xl')],
      display: [v('text-display'), v('lh-display')],
      table: [v('text-table'), v('lh-table')],
    },
    fontWeight: { regular: v('weight-regular'), medium: v('weight-medium'), semibold: v('weight-semibold'), heavy: v('weight-heavy') },
    letterSpacing: { normal: '0em', tight: v('tracking-tight'), snug: v('tracking-snug') },
    transitionDuration: { DEFAULT: v('dur-fast'), fast: v('dur-fast'), base: v('dur-base'), slow: v('dur-slow') },
    transitionTimingFunction: { DEFAULT: v('ease-out'), out: v('ease-out'), standard: v('ease-standard') },
    extend: {
      // Overlay motion (DESIGN_SYSTEM section 9): fade and rise, always in answer to an action.
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'rise-4': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        'rise-6': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        'sheet-in': { from: { transform: 'translateY(24px)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
        // DateRail fill draws once from the left (g2-d.css rail-grow); the duration token goes to ~0 under reduced motion.
        'rail-grow': { from: { transform: 'scaleX(0)' }, to: { transform: 'none' } },
      },
      animation: {
        'fade-in': 'fade-in var(--dur-base) var(--ease-out) both',
        'rise-4': 'rise-4 var(--dur-base) var(--ease-out) both',
        'rise-6': 'rise-6 var(--dur-base) var(--ease-out) both',
        'sheet-in': 'sheet-in var(--dur-base) var(--ease-out) both',
        'rail-grow': 'rail-grow var(--dur-slow) var(--ease-out) both',
      },
      // Heights scale with the text size (normal or [data-text="small"]): never a fixed pixel height around text.
      height: {
        control: v('control-h'),
        'control-sm': v('control-sm-h'),
        'control-lg': v('control-lg-h'),
        segment: v('segment-h'),
        chip: v('chip-h'),
        row: v('row-h'),
        'row-tall': v('row-h-tall'),
        head: v('head-h'),
        topbar: v('topbar-h'),
        touch: v('hit-touch'),
        indicator: '2px',
      },
      minHeight: {
        control: v('control-h'),
        'control-sm': v('control-sm-h'),
        'control-lg': v('control-lg-h'),
        segment: v('segment-h'),
        chip: v('chip-h'),
        row: v('row-h'),
        'row-tall': v('row-h-tall'),
        head: v('head-h'),
        touch: v('hit-touch'),
      },
      minWidth: { touch: v('hit-touch'), chip: v('chip-h') },
      width: {
        nav: v('nav-w'),
        touch: v('hit-touch'),
        control: v('control-h'),
        'control-sm': v('control-sm-h'),
        'control-lg': v('control-lg-h'),
      },
      size: { 'icon-chip': v('icon-chip'), 'control-sm': v('control-sm-h'), touch: v('hit-touch') },
      // Page caps from DESIGN_SYSTEM 12: work lists 860, tables 1280 (content width).
      // detail: RFQ, Order and Company pages (round-2 spec 5.1); lists use table.
      // One page frame: list (table) and detail pages share 1280, so a title sits at the same left edge when you go from a list to a record
      // (it was 1440 for detail: x=32 against x=112 at 1440 wide). `list` is the narrow reading column (notices, forms).
      maxWidth: { list: '860px', table: '1280px', detail: '1280px', prose: '66ch' },
    },
  },
  plugins: [animate],
} satisfies Config
