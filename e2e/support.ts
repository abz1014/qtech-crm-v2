import { expect, type Page } from '@playwright/test'

/** The fixed "now" for every gallery run: Friday 27 November 2026, 10:00 in Karachi. */
export const FIXED_NOW = new Date('2026-11-27T10:00:00+05:00')

const FREEZE_CSS = `
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }
`

import { SCENE_LIST } from '../src/dev/gallery/sceneList'

export interface Scene {
  /** Screenshot and test name. */
  name: string
  /** `?scene=` value. */
  scene: string
  /** Optional interaction that puts the overlay in the state to photograph. */
  steps?: (page: Page) => Promise<void>
}

type Steps = (page: Page) => Promise<void>

/** Interactions that open a scene. A scene not listed here is photographed as it loads. */
const STEPS: Record<string, Steps> = {
  'palette-typing': async page => {
    await page.getByRole('combobox').fill('ind')
    await page.clock.runFor(600)
  },
  'palette-empty': async page => {
    await page.getByRole('combobox').fill('zzzz')
    await page.clock.runFor(600)
  },
  'toast-settled': async page => {
    await page.clock.runFor(1300)
  },
  // Paused: four seconds of the countdown go by, then the pointer rests on the toast and it stops at 6 s.
  'toast-paused': async page => {
    await page.clock.runFor(4000)
    await page.getByRole('status').first().hover()
  },
  'toast-two': async page => {
    await page.clock.runFor(2000)
  },
  'toast-phone': async page => {
    await page.clock.runFor(1000)
  },
  'infotip-open': async page => {
    await page.locator('[data-infotip]').first().click()
  },
  'combobox-open': async page => {
    await page.locator('[data-preview-combo]').click()
    await page.keyboard.type('Ind')
    await page.clock.runFor(300)
  },
}

/** The 'overlays' scene holds three things that each open on their own, so it is photographed three times. */
const OVERLAY_VARIANTS: Scene[] = [
  {
    name: 'tooltip-open',
    scene: 'overlays',
    steps: async page => {
      await page.locator('[data-preview-tip]').focus()
      await page.clock.runFor(600)
    },
  },
  { name: 'menu-open', scene: 'overlays', steps: async page => void (await page.locator('[data-preview-menu]').click()) },
  { name: 'info-popover-open', scene: 'overlays', steps: async page => void (await page.locator('[data-preview-info]').click()) },
]

/** The 'tooltips' scene holds four tooltips that each open on their own: photographed once per tooltip. */
const TOOLTIP_VARIANTS: Scene[] = (
  [
    ['tooltip-disabled', '[data-preview-disabled] [tabindex="0"]'],
    ['tooltip-long', '[data-preview-long]'],
    ['tooltip-status', '[data-preview-status] [tabindex="0"]'],
    ['tooltip-twoline', '[data-preview-twoline]'],
  ] as const
).map(([name, hook]) => ({
  name,
  scene: 'tooltips',
  steps: async (page: Page) => {
    await page.locator(hook).focus()
    await page.clock.runFor(600)
  },
}))

for (const key of Object.keys(STEPS)) {
  if (!SCENE_LIST.some(s => s.scene === key)) throw new Error(`e2e/support.ts has steps for a scene that does not exist: ${key}`)
}

/** Every scene in SCENE_LIST (src/dev/gallery/sceneList.ts), with the interaction that opens it. */
export const SCENES: Scene[] = SCENE_LIST.flatMap(s =>
  s.scene === 'overlays' ? OVERLAY_VARIANTS : s.scene === 'tooltips' ? TOOLTIP_VARIANTS : [{ name: s.scene, scene: s.scene, steps: STEPS[s.scene] }],
)

/**
 * Open a gallery URL in a state that renders the same every time: the clock is installed at FIXED_NOW
 * and paused (so Date, timers and countdowns stand still), animations and transitions are off, and the
 * Geist faces are confirmed loaded before anything is photographed or checked.
 */
export async function openGallery(page: Page, search = ''): Promise<void> {
  await page.clock.install({ time: FIXED_NOW })
  // Stand still before the page exists: no countdown, debounce or relative time can move under a screenshot.
  await page.clock.pauseAt(new Date(FIXED_NOW.getTime() + 1000))
  await page.goto(`/dev/gallery${search}`)
  // The gallery is lazy-loaded: wait for the page itself, or axe can run on an empty document (no main, no h1).
  if (!search.includes('scene=')) await page.getByRole('heading', { level: 1, name: 'Component gallery' }).waitFor()
  await page.addStyleTag({ content: FREEZE_CSS })
  await page.evaluate(() => document.fonts.ready)
  const fonts = await page.evaluate(async () => {
    await Promise.all([document.fonts.load('400 14px "Geist"'), document.fonts.load('500 14px "Geist"'), document.fonts.load('400 14px "Geist Mono"')])
    return ['400 14px "Geist"', '500 14px "Geist"', '400 14px "Geist Mono"'].map(f => document.fonts.check(f))
  })
  expect(fonts, 'Geist Sans and Geist Mono must be loaded before a baseline is taken').toEqual([true, true, true])
}
