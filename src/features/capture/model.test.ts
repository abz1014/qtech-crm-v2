import { describe, expect, it } from 'vitest'
import {
  appendNote,
  countsText,
  shortDay,
  shortQuestion,
  availability,
  defaultRfq,
  defaultTicks,
  guessDestination,
  noteStamp,
  orderCandidates,
  payloadKind,
  saveLabel,
  savedSummary,
  type Candidate,
  type OpenQuestion,
} from '@/features/capture/model'

const q = (id: string, asked = true): OpenQuestion => ({ id, question: `Question ${id}`, asked, askedAt: asked ? '2026-11-21T08:00:00Z' : null, createdAt: `2026-10-1${id}` })
const cand = (n: number, o: Partial<Candidate> = {}): Candidate => ({ id: `r${n}`, number: n, companyName: `Co ${n}`, ownerId: 'u1', city: null, openedAt: null, open: [], ...o })
const HOUR = 3_600_000
const NOW = 100 * 24 * HOUR

describe('which RFQs come first', () => {
  it('recently opened (last 24 h) newest first, then yours with the most open questions', () => {
    const list = [
      cand(5, { open: [q('1')] }),
      cand(177, { openedAt: NOW - 2 * HOUR, open: [q('1'), q('2')] }),
      cand(183, { openedAt: NOW - 5 * HOUR, open: [q('1')] }),
      cand(9, { openedAt: NOW - 3 * 24 * HOUR }),
      cand(178, { open: [q('1'), q('2')] }),
    ]
    expect(orderCandidates(list, NOW).map(c => c.number)).toEqual([177, 183, 178, 5, 9])
  })
})

describe('the pre-selected destination (one tap confirms)', () => {
  const waiting = [cand(177, { openedAt: NOW - HOUR, open: [q('1'), q('2')] }), cand(183, { openedAt: NOW - 2 * HOUR, open: [q('1')] })]

  it('a photo or a text goes to Answer when a question is waiting', () => {
    expect(guessDestination('files', '', waiting)).toBe('answer')
    expect(guessDestination('text', 'Line size is 4 inch', waiting)).toBe('answer')
  })

  it('with nothing waiting: a list of questions becomes supplier questions, long text a new RFQ, short text notes, files notes', () => {
    const none = [cand(1, { openedAt: NOW })]
    expect(guessDestination('text', '1. Valve size?\n2. Torque?\n3. Fail-safe?', none)).toBe('questions')
    expect(guessDestination('text', 'x'.repeat(500), none)).toBe('new-rfq')
    expect(guessDestination('text', 'Customer will send the P&ID on Monday', none)).toBe('notes')
    expect(guessDestination('files', '', none)).toBe('notes')
    expect(guessDestination('text', 'Please quote 2 nos transmitter', [])).toBe('new-rfq')
    // A supplier's price reply goes to "A supplier's prices", even with a question waiting; never for an engineer (no prices).
    const reply = 'Dear Sir,\n1) Rosemount 3051CD - GBP 1,840 each, 4 weeks\n2) Rosemount 644 - GBP 385 each'
    expect(guessDestination('text', reply, waiting)).toBe('reply')
    expect(guessDestination('text', reply, none)).toBe('reply')
    expect(guessDestination('text', reply, waiting, false)).toBe('answer')
    expect(guessDestination('text', 'Budget is USD 5,000 for the lot', none)).toBe('notes')
  })

  it('the RFQ for an answer is the first with an open question; otherwise the most recent', () => {
    expect(defaultRfq('answer', [cand(1, { openedAt: NOW }), ...waiting])?.number).toBe(177)
    expect(defaultRfq('notes', [cand(1, { openedAt: NOW }), ...waiting])?.number).toBe(1)
    expect(defaultRfq('new-rfq', waiting)).toBeNull()
  })

  it('a text answers every open question; a photo alone answers the first', () => {
    const open = [q('1'), q('2')]
    expect(defaultTicks('text', open)).toEqual(['1', '2'])
    expect(defaultTicks('both', open)).toEqual(['1', '2'])
    expect(defaultTicks('files', open)).toEqual(['1'])
    expect(defaultTicks('text', [])).toEqual([])
  })
})

describe('what can be chosen, and what the buttons say', () => {
  it('nothing can be chosen until something is added', () => {
    expect(payloadKind('  ', 0)).toBe('empty')
    expect(availability('notes', 'empty', null).ok).toBe(false)
  })

  it('questions and a supplier reply need text; an answer needs an open question', () => {
    expect(availability('questions', 'files', null).ok).toBe(false)
    expect(availability('reply', 'files', null).ok).toBe(false)
    expect(availability('answer', 'text', cand(1)).ok).toBe(false)
    expect(availability('answer', 'text', cand(1, { open: [q('1')] })).ok).toBe(true)
  })

  it('the button names the action', () => {
    expect(saveLabel({ dest: 'answer', kind: 'text', ticked: 2, questionLines: 0 })).toBe('Save answer to 2 questions')
    expect(saveLabel({ dest: 'answer', kind: 'files', ticked: 1, questionLines: 0 })).toBe('Save photo as the answer')
    expect(saveLabel({ dest: 'questions', kind: 'text', ticked: 0, questionLines: 4 })).toBe('Add 4 questions')
    expect(saveLabel({ dest: 'new-rfq', kind: 'text', ticked: 0, questionLines: 0 })).toBe('Continue to New RFQ')
    expect(saveLabel({ dest: 'order', kind: 'files', ticked: 0, questionLines: 0 })).toBe('Attach to order')
    expect(saveLabel({ dest: 'order', kind: 'text', ticked: 0, questionLines: 0 })).toBe('Add to order notes')
    expect(savedSummary('answer', { questions: 2, photos: 1 })).toBe('2 questions answered and 1 photo attached.')
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

describe('the words under the capture and the RFQ list (g2-capture.html)', () => {
  it('counts: a shared text is a message; photos are photos, anything else files', () => {
    expect(countsText('share', 'x', [{ type: 'image/jpeg' }])).toBe('1 message · 1 photo')
    expect(countsText('paste', 'x', [])).toBe('1 text')
    expect(countsText('share', '', [{ type: 'image/png' }])).toBe('1 photo')
    expect(countsText('paste', 'x', [{ type: 'image/png' }, { type: 'application/pdf' }])).toBe('1 text · 2 files')
  })
  it('a question is shortened to its subject', () => {
    expect(shortQuestion('Line size and flange rating on the process line for item 2')).toBe('line size and flange rating')
    expect(shortQuestion('Fluid temperature range, and whether the meter sees CIP cleaning')).toBe('fluid temperature range')
  })
  it('the asked day reads like Sat 21 Nov', () => {
    expect(shortDay('2026-11-21T08:00:00Z')).toBe('Sat 21 Nov')
  })
})
