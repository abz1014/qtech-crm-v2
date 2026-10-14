import { expect, type Page } from '@playwright/test'

/** The fixed "now" for every gallery run: Friday 27 November 2026, 10:00 in Karachi. */
export const FIXED_NOW = new Date('2026-11-27T10:00:00+05:00')

const FREEZE_CSS = `
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }
`

export interface Scene {
  /** Screenshot and test name. */
  name: string
  /** `?scene=` value. */
  scene: string
  /** Optional interaction that puts the overlay in the state to photograph. */
  steps?: (page: Page) => Promise<void>
}

/** Every overlay scene, with the interaction that opens it. Keep in step with SCENES in src/dev/gallery/scenes.tsx. */
export const SCENES: Scene[] = [
  { name: 'dialog-default', scene: 'dialog-default' },
  { name: 'dialog-busy', scene: 'dialog-busy' },
  { name: 'dialog-error', scene: 'dialog-error' },
  { name: 'dialog-confirm', scene: 'dialog-confirm' },
  { name: 'dialog-long', scene: 'dialog-long' },
  { name: 'dialog-money', scene: 'dialog-money' },
  { name: 'palette-idle', scene: 'palette-idle' },
  {
    name: 'palette-typing',
    scene: 'palette-typing',
    steps: async page => {
      await page.getByRole('combobox').fill('ind')
      await page.clock.runFor(600)
    },
  },
  {
    name: 'palette-empty',
    scene: 'palette-empty',
    steps: async page => {
      await page.getByRole('combobox').fill('zzzz')
      await page.clock.runFor(600)
    },
  },
  { name: 'toast-undo', scene: 'toast-undo' },
  {
    name: 'toast-settled',
    scene: 'toast-settled',
    steps: async page => {
      await page.clock.runFor(1300)
    },
  },
  { name: 'toast-error', scene: 'toast-error' },
  { name: 'toast-plain', scene: 'toast-plain' },
  {
    name: 'combobox-open',
    scene: 'combobox-open',
    steps: async page => {
      const box = page.locator('[data-preview-combo]')
      await box.click()
      await page.keyboard.type('Ind')
      await page.clock.runFor(300)
    },
  },
  {
    name: 'tooltip-open',
    scene: 'overlays',
    steps: async page => {
      await page.locator('[data-preview-tip]').focus()
      await page.clock.runFor(600)
    },
  },
  {
    name: 'menu-open',
    scene: 'overlays',
    steps: async page => {
      await page.locator('[data-preview-menu]').click()
    },
  },
  {
    name: 'info-popover-open',
    scene: 'overlays',
    steps: async page => {
      await page.locator('[data-preview-info]').click()
    },
  },
]

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
  await page.addStyleTag({ content: FREEZE_CSS })
  await page.evaluate(() => document.fonts.ready)
  const fonts = await page.evaluate(async () => {
    await Promise.all([document.fonts.load('400 14px "Geist"'), document.fonts.load('500 14px "Geist"'), document.fonts.load('400 14px "Geist Mono"')])
    return ['400 14px "Geist"', '500 14px "Geist"', '400 14px "Geist Mono"'].map(f => document.fonts.check(f))
  })
  expect(fonts, 'Geist Sans and Geist Mono must be loaded before a baseline is taken').toEqual([true, true, true])
}
