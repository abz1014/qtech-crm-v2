import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Safe auto-update (2026-10-26): a waiting service worker is switched to by itself, but only when the app is on screen, nothing
 * is being typed and no dialog is open. Otherwise the toast stays and nothing reloads.
 */

class FakeWorkbox {
  static last: FakeWorkbox
  handlers: Record<string, () => void> = {}
  messageSkipWaiting = vi.fn()
  update = vi.fn(async () => {})
  register = vi.fn(async () => undefined)
  constructor() {
    FakeWorkbox.last = this
  }
  addEventListener(type: string, fn: () => void) {
    this.handlers[type] = fn
  }
}

let visibility: 'visible' | 'hidden' = 'visible'
const setVisibility = (v: 'visible' | 'hidden') => {
  visibility = v
  document.dispatchEvent(new Event('visibilitychange'))
}

async function start() {
  vi.resetModules()
  vi.doMock('workbox-window', () => ({ Workbox: FakeWorkbox }))
  const mod = await import('@/lib/pwa/updates')
  const { RUNNING_BUILD } = await import('@/lib/pwa/buildInfo')
  // the same module instance the code under test reads (resetModules gave it a fresh one)
  const { setFormDirty } = await import('@/lib/pwa/dirtyForms')
  await mod.registerServiceWorker()
  return { mod, wb: FakeWorkbox.last, setFormDirty, RUNNING_BUILD }
}

beforeEach(() => {
  vi.stubEnv('PROD', true)
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} })
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.doUnmock('workbox-window')
  document.body.innerHTML = ''
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

describe('isSafeToSwitch', () => {
  it('is safe only when visible, not typing and no dialog is open', async () => {
    const { isSafeToSwitch } = await import('@/lib/pwa/updates')
    expect(isSafeToSwitch({ visible: true, typing: false, dialogOpen: false })).toBe(true)
    expect(isSafeToSwitch({ visible: false, typing: false, dialogOpen: false })).toBe(false)
    expect(isSafeToSwitch({ visible: true, typing: true, dialogOpen: false })).toBe(false)
    expect(isSafeToSwitch({ visible: true, typing: false, dialogOpen: true })).toBe(false)
  })
})

describe('a waiting worker', () => {
  it('is switched to at once on start when the app is on screen and idle', async () => {
    const { mod, wb } = await start()
    wb.handlers.waiting()
    expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1)
    expect(mod.isApplyingUpdate()).toBe(true)
  })

  it('waits while a form holds unsaved edits, then switches when the person comes back and nothing is typed', async () => {
    const { mod, wb, setFormDirty } = await start()
    setFormDirty('typing', true)
    wb.handlers.waiting()
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled()
    expect(mod.isApplyingUpdate()).toBe(false)
    setVisibility('hidden')
    setVisibility('visible')
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled() // still typing: never lose it
    setFormDirty('typing', false)
    setVisibility('hidden')
    setVisibility('visible')
    expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1)
  })

  it('does not switch while text sits in a focused field', async () => {
    const { wb } = await start()
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    input.value = 'half a quote'
    wb.handlers.waiting()
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled()
    input.value = ''
    setVisibility('visible')
    expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1)
  })

  it('does not switch while a dialog is open', async () => {
    const { wb } = await start()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    wb.handlers.waiting()
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled()
    dialog.remove()
    setVisibility('visible')
    expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1)
  })

  it('does not switch while the app is in the background; the return switches', async () => {
    const { wb } = await start()
    visibility = 'hidden'
    wb.handlers.waiting()
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled()
    setVisibility('visible')
    expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1)
  })

  it('one that turns up in the middle of a session (not just after a start or a return) waits for the toast or the next return', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { wb } = await start()
    vi.setSystemTime(Date.now() + 10 * 60_000)
    wb.handlers.waiting()
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled()
    setVisibility('visible')
    expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1)
  })

  it('reloads the page once the new worker controls it, and only when a switch was asked for', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    const { wb } = await start()
    wb.handlers.controlling()
    expect(reload).not.toHaveBeenCalled()
    wb.handlers.waiting()
    wb.handlers.controlling()
    expect(reload).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})

describe('looking for a new worker', () => {
  it('returning to the app asks the browser for the newest worker', async () => {
    const { wb } = await start()
    setVisibility('visible')
    expect(wb.update).toHaveBeenCalledTimes(1)
  })

  it('a published build other than this one fetches the worker at once; the same build does not', async () => {
    const { mod, wb, RUNNING_BUILD } = await start()
    mod.noteDeployedBuild({ build: RUNNING_BUILD })
    mod.noteDeployedBuild({})
    mod.noteDeployedBuild(null)
    expect(wb.update).not.toHaveBeenCalled()
    mod.noteDeployedBuild({ build: 'a-newer-commit' })
    expect(wb.update).toHaveBeenCalledTimes(1)
  })
})

describe('Check for update now', () => {
  const answer = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response)

  it('says offline when /version.json cannot be read', async () => {
    const { mod } = await start()
    expect(
      await mod.checkForUpdateNow(
        0,
        vi.fn(async () => {
          throw new TypeError('offline')
        }),
      ),
    ).toBe('offline')
    expect(await mod.checkForUpdateNow(0, answer({}, false))).toBe('offline')
  })

  it('says latest when this is the live build and nothing waits', async () => {
    const { mod, wb, RUNNING_BUILD } = await start()
    expect(await mod.checkForUpdateNow(0, answer({ build: RUNNING_BUILD }))).toBe('latest')
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled()
  })

  it('switches to a waiting worker, unless a form holds unsaved edits', async () => {
    const { mod, wb, setFormDirty } = await start()
    setFormDirty('typing', true)
    wb.handlers.waiting() // not applied: typing
    expect(await mod.checkForUpdateNow(0, answer({ build: 'newer' }))).toBe('blocked')
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled()
    setFormDirty('typing', false)
    expect(await mod.checkForUpdateNow(0, answer({ build: 'newer' }))).toBe('updating')
    expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1)
  })

  it('says a newer build is on its way when the live build differs but its worker has not arrived yet', async () => {
    const { mod, wb } = await start()
    expect(await mod.checkForUpdateNow(0, answer({ build: 'newer' }))).toBe('pending')
    expect(wb.update).toHaveBeenCalled()
  })
})
