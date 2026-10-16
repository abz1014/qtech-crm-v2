import { describe, expect, it } from 'vitest'
import {
  agoText,
  answersToRelay,
  attachmentPath,
  canPreview,
  chaseDue,
  clarState,
  daysBetween,
  fileExtension,
  groupClarifications,
  PATH_FORMAT,
  relayText,
  splitQuestions,
  type ClarLike,
} from './clarifications'

const clar = (o: Partial<ClarLike> & { id: string }): ClarLike => ({
  question: 'Q',
  raisedByInquiryId: null,
  firstAskedAt: null,
  lastAskedAt: null,
  askCount: 0,
  answer: null,
  answeredAt: null,
  withdrawnAt: null,
  createdAt: '2026-11-20T10:00:00Z',
  ...o,
})

describe('splitQuestions', () => {
  it('splits a pasted message into one question per line and strips numbering and bullets', () => {
    const text = '1. What flange size?\n2) Is Ex certification needed?\n- HART or plain 4-20 mA?\n• Q4: Cable length\n\n  \nQ5. Fluid temperature'
    expect(splitQuestions(text)).toEqual(['What flange size?', 'Is Ex certification needed?', 'HART or plain 4-20 mA?', 'Cable length', 'Fluid temperature'])
  })
  it('splits several questions that arrive on one line, and drops repeats', () => {
    expect(splitQuestions('What size? Which rating? What size?')).toEqual(['What size?', 'Which rating?'])
  })
  it('keeps a question whose number is part of the text', () => {
    expect(splitQuestions('2 inch or 3 inch line?')).toEqual(['2 inch or 3 inch line?'])
  })
  it('an empty paste gives nothing', () => {
    expect(splitQuestions(' \n\r\n ')).toEqual([])
  })
})

describe('state and groups', () => {
  it('derives the state from the timestamps', () => {
    expect(clarState(clar({ id: 'a' }))).toBe('to-ask')
    expect(clarState(clar({ id: 'a', lastAskedAt: 'x', askCount: 1 }))).toBe('asked')
    expect(clarState(clar({ id: 'a', lastAskedAt: 'x', askCount: 1, answeredAt: 'y' }))).toBe('answered')
    expect(clarState(clar({ id: 'a', withdrawnAt: 'y' }))).toBe('withdrawn')
  })
  it('groups in the order they were raised', () => {
    const g = groupClarifications([
      clar({ id: 'b', createdAt: '2026-11-21T00:00:00Z' }),
      clar({ id: 'a', createdAt: '2026-11-20T00:00:00Z' }),
      clar({ id: 'c', askCount: 2, lastAskedAt: 'z' }),
      clar({ id: 'd', answeredAt: 'z' }),
      clar({ id: 'e', withdrawnAt: 'z' }),
    ])
    expect(g.toAsk.map(c => c.id)).toEqual(['a', 'b'])
    expect(g.asked.map(c => c.id)).toEqual(['c'])
    expect(g.answered.map(c => c.id)).toEqual(['d'])
    expect(g.withdrawn.map(c => c.id)).toEqual(['e'])
  })
})

describe('days waiting and chase due', () => {
  it('counts calendar days', () => {
    expect(daysBetween('2026-11-21', '2026-11-27')).toBe(6)
    expect(daysBetween('2026-11-27', '2026-11-27')).toBe(0)
    expect(daysBetween('2026-11-28', '2026-11-27')).toBe(0)
  })
  it('says it plainly', () => {
    expect(agoText(0)).toBe('today')
    expect(agoText(1)).toBe('yesterday')
    expect(agoText(6)).toBe('6 days ago')
  })
  it('a chase is due after 3 days, or 1 day when the bid is within 3 days', () => {
    expect(chaseDue(2, '2026-12-10', '2026-11-27')).toBe(false)
    expect(chaseDue(3, '2026-12-10', '2026-11-27')).toBe(true)
    expect(chaseDue(1, '2026-11-29', '2026-11-27')).toBe(true)
    expect(chaseDue(0, '2026-11-29', '2026-11-27')).toBe(false)
    expect(chaseDue(1, null, '2026-11-27')).toBe(false)
    expect(chaseDue(2, '2026-11-20', '2026-11-27')).toBe(false)
  })
})

describe('relay', () => {
  const rows = [
    clar({ id: '1', raisedByInquiryId: 'i1', answeredAt: '2026-11-25T10:00:00Z' }),
    clar({ id: '2', raisedByInquiryId: 'i1', answeredAt: '2026-11-26T10:00:00Z' }),
    clar({ id: '3', raisedByInquiryId: 'i2', answeredAt: '2026-11-26T10:00:00Z' }),
    clar({ id: '4', raisedByInquiryId: 'i1' }),
    clar({ id: '5', raisedByInquiryId: null, answeredAt: '2026-11-26T10:00:00Z' }),
  ]
  it('answers waiting for a supplier are those answered after the last relay', () => {
    expect(answersToRelay(rows, { id: 'i1', lastRelayedAt: null }).map(c => c.id)).toEqual(['1', '2'])
    expect(answersToRelay(rows, { id: 'i1', lastRelayedAt: '2026-11-25T12:00:00Z' }).map(c => c.id)).toEqual(['2'])
    expect(answersToRelay(rows, { id: 'i1', lastRelayedAt: '2026-11-27T00:00:00Z' })).toEqual([])
  })
  it('a photo-only answer reads "see attached photo"', () => {
    const t = relayText({
      rfqRef: 'RFQ-0177',
      contactName: 'Bilal',
      lines: [
        { question: 'What flange?', answer: null, hasPhoto: true },
        { question: 'HART?', answer: 'Plain 4-20 mA', hasPhoto: false },
        { question: 'Probe?', answer: 'PHC101', hasPhoto: true },
      ],
      signature: { name: 'Ayesha', company: 'Q-Tech Solutions' },
    })
    expect(t).toContain('1. What flange?\n   see attached photo')
    expect(t).toContain('2. HART?\n   Plain 4-20 mA')
    expect(t).toContain('3. Probe?\n   PHC101 (see attached photo)')
    expect(t).toContain('Assalam o Alaikum Bilal,')
  })
})

describe('files', () => {
  it('builds {parent_id}/{uuid}.{ext}', () => {
    const p = attachmentPath('3f2b8c1e-0000-4000-8000-000000000001', '9a1b2c3d-0000-4000-8000-000000000002', 'Nameplate.JPEG', 'image/jpeg')
    expect(p).toBe('3f2b8c1e-0000-4000-8000-000000000001/9a1b2c3d-0000-4000-8000-000000000002.jpg')
    expect(PATH_FORMAT.test(p)).toBe(true)
  })
  it('takes the extension from the type, else from the name', () => {
    expect(fileExtension('IMG_1.HEIC', 'image/heic')).toBe('heic')
    expect(fileExtension('drawing.dwg', 'application/octet-stream')).toBe('dwg')
    expect(fileExtension('noext', 'application/octet-stream')).toBe('bin')
  })
  it('previews only what a browser shows', () => {
    expect(canPreview('image/jpeg')).toBe(true)
    expect(canPreview('image/heic')).toBe(false)
    expect(canPreview('application/pdf')).toBe(false)
  })
})
