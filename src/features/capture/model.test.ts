import { describe, expect, it } from 'vitest'
import { appendLine, appendNote, countsText, looksLikePriceReply, noteStamp, shortDay } from '@/features/capture/model'

describe('a supplier price reply', () => {
  it('needs at least two amounts written with a currency', () => {
    expect(looksLikePriceReply('Rosemount 3051CD - GBP 1,840 each\nRosemount 644 - GBP 385 each')).toBe(true)
    expect(looksLikePriceReply('Budget is USD 5,000 for the lot')).toBe(false)
    expect(looksLikePriceReply('Line size is 4 inch')).toBe(false)
  })
})

describe('notes are appended as written, with who and when', () => {
  it('stamps in Karachi time and keeps what was there', () => {
    const stamp = noteStamp('Ayesha Rana', new Date('2026-11-27T04:41:00Z'))
    expect(stamp).toBe('Ayesha Rana, Fri 27 Nov, 09:41')
    expect(appendNote(null, ' Plant shutdown 12 Dec ', stamp)).toBe(`${stamp}\nPlant shutdown 12 Dec`)
    expect(appendNote('Earlier note', 'More', stamp)).toBe(`Earlier note\n\n${stamp}\nMore`)
  })
})

describe('a line added under the notes', () => {
  it('goes on a line of its own, or starts the notes', () => {
    expect(appendLine(null, 'a')).toBe('a')
    expect(appendLine('  ', 'a')).toBe('a')
    expect(appendLine('x ' + String.fromCharCode(10), 'a')).toBe('x' + String.fromCharCode(10) + 'a')
  })
})

describe('the words under the capture', () => {
  it('counts: a shared text is a message; photos are photos, anything else files', () => {
    expect(countsText('share', 'x', [{ type: 'image/jpeg' }])).toBe('1 message · 1 photo')
    expect(countsText('paste', 'x', [])).toBe('1 text')
    expect(countsText('share', '', [{ type: 'image/png' }])).toBe('1 photo')
    expect(countsText('paste', 'x', [{ type: 'image/png' }, { type: 'application/pdf' }])).toBe('1 text · 2 files')
  })
  it('the asked day reads like Sat 21 Nov', () => {
    expect(shortDay('2026-11-21T08:00:00Z')).toBe('Sat 21 Nov')
  })
})
