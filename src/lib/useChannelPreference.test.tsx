import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import { channelKey, useChannelPreference } from '@/lib/useChannelPreference'

const as = (id: string): SessionState => ({ status: 'signed-in', user: { id, name: 'Ayesha Rana', role: 'sales' } })

function hook(initial: SessionState = as('u1')) {
  let state = initial
  const wrapper = ({ children }: { children: ReactNode }) => <SessionProvider value={state}>{children}</SessionProvider>
  const r = renderHook(() => useChannelPreference(), { wrapper })
  return {
    ...r,
    switchTo: (next: SessionState) => {
      state = next
      r.rerender()
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('useChannelPreference', () => {
  it('starts on WhatsApp when nothing is remembered', () => {
    expect(hook().result.current[0]).toBe('whatsapp')
  })

  it('remembers the last choice per person, under qtech.channel.<person id>', () => {
    const first = hook()
    act(() => first.result.current[1]('email'))
    expect(first.result.current[0]).toBe('email')
    expect(window.localStorage.getItem('qtech.channel.u1')).toBe('email')
    first.unmount()
    expect(hook().result.current[0]).toBe('email') // next visit
    expect(hook(as('u2')).result.current[0]).toBe('whatsapp') // someone else on this device
  })

  it('reads the other person’s choice when the session changes under a mounted screen', () => {
    window.localStorage.setItem(channelKey('u2'), 'email')
    const h = hook()
    expect(h.result.current[0]).toBe('whatsapp')
    h.switchTo(as('u2'))
    expect(h.result.current[0]).toBe('email')
  })

  it('signed out uses the anon key', () => {
    const h = hook({ status: 'signed-out' })
    act(() => h.result.current[1]('email'))
    expect(window.localStorage.getItem('qtech.channel.anon')).toBe('email')
  })

  it('ignores a stored value that is not a channel', () => {
    window.localStorage.setItem(channelKey('u1'), 'sms')
    expect(hook().result.current[0]).toBe('whatsapp')
  })

  it('still works when storage throws: the choice applies, it is just not remembered', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const h = hook()
    expect(h.result.current[0]).toBe('whatsapp')
    act(() => h.result.current[1]('email'))
    expect(h.result.current[0]).toBe('email')
  })
})
