import { describe, expect, it } from 'vitest'
import '@/lib/zodConfig'
import { z } from 'zod'

describe('zodConfig', () => {
  it('zod picks up jitless set before it loads (no zod import in the start-up file)', () => {
    expect(z.config().jitless).toBe(true)
  })
})
