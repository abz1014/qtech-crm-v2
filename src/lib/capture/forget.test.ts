import { beforeEach, describe, expect, it } from 'vitest'
import { forgetDeviceCaptures } from '@/lib/capture/forget'

beforeEach(() => window.localStorage.clear())

describe('forgetDeviceCaptures (sign-out wipe)', () => {
  it('removes every person\'s palette recents and the old shared key (BUG-RV-04)', async () => {
    window.localStorage.setItem('qtech.palette.recent', '[]')
    window.localStorage.setItem('qtech.palette.recent.u1', '[]')
    window.localStorage.setItem('qtech.palette.recent.u2', '[]')
    window.localStorage.setItem('qtech.other', 'kept')
    await forgetDeviceCaptures()
    expect(Object.keys(window.localStorage)).toEqual(['qtech.other'])
  })

  it('overlapping calls share one wipe (the Sign out button, then Auth\'s SIGNED_OUT)', async () => {
    const a = forgetDeviceCaptures()
    const b = forgetDeviceCaptures()
    expect(b).toBe(a)
    await a
  })
})
