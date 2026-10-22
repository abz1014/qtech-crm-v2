import { describe, expect, it } from 'vitest'
import { isInvalidIdError, nullOnInvalidId } from '@/lib/uuid'

describe('a mistyped record id (HE-20)', () => {
  const bad = { code: '22P02', message: 'invalid input syntax for type uuid: "zzz"' }
  it('recognises the invalid-uuid answer', () => {
    expect(isInvalidIdError(bad)).toBe(true)
    expect(isInvalidIdError({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isInvalidIdError(new TypeError('Failed to fetch'))).toBe(false)
    expect(isInvalidIdError(null)).toBe(false)
  })
  it('reads it as "no such record" and rethrows anything else', async () => {
    await expect(Promise.reject(bad).catch(nullOnInvalidId)).resolves.toBeNull()
    const net = new TypeError('Failed to fetch')
    await expect(Promise.reject(net).catch(nullOnInvalidId)).rejects.toBe(net)
  })
})
