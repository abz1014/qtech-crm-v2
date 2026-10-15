import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasDirtyForms, setFormDirty } from '@/lib/pwa/dirtyForms'
import { isIosSafari } from '@/lib/pwa/install'
import { isShellNavigation } from '@/lib/pwa/shellRoute'

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0 Mobile/15E148 Safari/604.1'
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
const IPAD_DESKTOP_MODE = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'

describe('platform detection', () => {
  it('iPhone Safari yes; iOS Chrome, Android Chrome and a desktop Mac no; iPad in desktop mode yes', () => {
    expect(isIosSafari(IPHONE_SAFARI, 5)).toBe(true)
    expect(isIosSafari(IPHONE_CHROME, 5)).toBe(false)
    expect(isIosSafari(ANDROID_CHROME, 5)).toBe(false)
    expect(isIosSafari(IPAD_DESKTOP_MODE, 0)).toBe(false)
    expect(isIosSafari(IPAD_DESKTOP_MODE, 5)).toBe(true)
  })
})

describe('shell navigation matcher', () => {
  const origin = 'https://app.test'
  it('only same-origin navigations to extensionless paths', () => {
    expect(isShellNavigation({ mode: 'navigate' }, new URL('https://app.test/today'), origin)).toBe(true)
    expect(isShellNavigation({ mode: 'navigate' }, new URL('https://app.test/sw.js'), origin)).toBe(false)
    expect(isShellNavigation({ mode: 'cors' }, new URL('https://app.test/today'), origin)).toBe(false)
    expect(isShellNavigation({ mode: 'navigate' }, new URL('https://x.supabase.co/auth/v1/verify'), origin)).toBe(false)
  })
})

describe('dirty form registry', () => {
  it('is dirty while any form is dirty', () => {
    expect(hasDirtyForms()).toBe(false)
    setFormDirty('a', true)
    setFormDirty('b', true)
    setFormDirty('a', false)
    expect(hasDirtyForms()).toBe(true)
    setFormDirty('b', false)
    expect(hasDirtyForms()).toBe(false)
  })
})

describe('update flow', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    vi.doUnmock('workbox-window')
  })

  async function setup() {
    vi.resetModules()
    vi.stubEnv('PROD', true)
    const handlers: Record<string, () => void> = {}
    const messageSkipWaiting = vi.fn()
    vi.doMock('workbox-window', () => ({
      Workbox: class {
        addEventListener(t: string, h: () => void) {
          handlers[t] = h
        }
        register() {
          return Promise.resolve({ update: () => Promise.resolve() })
        }
        messageSkipWaiting = messageSkipWaiting
      },
    }))
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true })
    const updates = await import('@/lib/pwa/updates')
    const dirty = await import('@/lib/pwa/dirtyForms')
    updates.registerServiceWorker()
    return { updates, dirty, handlers, messageSkipWaiting }
  }

  it('does nothing until a new worker is waiting, and never skips waiting by itself', async () => {
    const { updates, messageSkipWaiting } = await setup()
    expect(updates.applyUpdate()).toBe('none')
    expect(messageSkipWaiting).not.toHaveBeenCalled()
  })

  it('Reload is blocked while a form is dirty, and goes ahead once it is saved', async () => {
    const { updates, dirty, handlers, messageSkipWaiting } = await setup()
    handlers.waiting()
    dirty.setFormDirty('form', true)
    expect(updates.applyUpdate()).toBe('blocked')
    expect(messageSkipWaiting).not.toHaveBeenCalled()
    dirty.setFormDirty('form', false)
    expect(updates.applyUpdate()).toBe('applying')
    expect(messageSkipWaiting).toHaveBeenCalledTimes(1)
  })

  it('a controller change without a Reload press never reloads the page', async () => {
    const { handlers } = await setup()
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, reload }, configurable: true })
    handlers.waiting()
    handlers.controlling()
    expect(reload).not.toHaveBeenCalled()
  })
})
