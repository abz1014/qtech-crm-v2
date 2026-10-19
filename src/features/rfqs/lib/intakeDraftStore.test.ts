import { beforeEach, describe, expect, it } from 'vitest'
import { forgetDeviceCaptures, INTAKE_DRAFT_KEYS } from '@/lib/capture/forget'
import {
  clearIntakeDraft,
  draftAge,
  draftHasContent,
  draftSummary,
  INTAKE_DRAFT_PREFIX,
  INTAKE_DRAFT_TTL_MS,
  intakeDraftKey,
  loadIntakeDraft,
  saveIntakeDraft,
  type IntakeDraft,
} from './intakeDraftStore'

const draft = (over: Partial<IntakeDraft> = {}): IntakeDraft => ({
  v: 1,
  savedAt: Date.UTC(2026, 10, 27, 5, 0),
  rfqId: 'r-1',
  company: { id: 'c', name: 'Indus Textile Mills', country: 'Pakistan', city: 'Faisalabad', role: 'customer' },
  siteId: null,
  contactId: null,
  dueOn: '',
  customerRef: '',
  isPriority: false,
  items: [
    { key: 'i1', description: 'Cerabar PMC71', qty: 2, unit: 'pcs', brandId: null, familyId: null },
    { key: 'i2', description: '  ', qty: null, unit: '', brandId: null, familyId: null },
  ],
  overrides: {},
  manual: [],
  ...over,
})

beforeEach(() => localStorage.clear())

describe('the New RFQ draft store', () => {
  it('keeps one draft per person and reads it back', () => {
    saveIntakeDraft('u1', draft())
    expect(loadIntakeDraft('u1', Date.UTC(2026, 10, 27, 6, 0))?.company?.name).toBe('Indus Textile Mills')
    expect(loadIntakeDraft('u2')).toBeNull()
    expect(localStorage.getItem(intakeDraftKey('u1'))).toContain('Cerabar PMC71')
  })

  it('an empty form is not kept, and saving one removes the old draft', () => {
    saveIntakeDraft('u1', draft())
    saveIntakeDraft('u1', draft({ company: null, items: [], customerRef: '' }))
    expect(localStorage.getItem(intakeDraftKey('u1'))).toBeNull()
    expect(draftHasContent(draft({ company: null, items: [], customerRef: 'ENQ-1' }))).toBe(true)
  })

  it('is forgotten after 7 days, and on Discard', () => {
    const d = draft()
    saveIntakeDraft('u1', d)
    expect(loadIntakeDraft('u1', d.savedAt + INTAKE_DRAFT_TTL_MS + 1)).toBeNull()
    expect(localStorage.getItem(intakeDraftKey('u1'))).toBeNull()
    saveIntakeDraft('u1', d)
    clearIntakeDraft('u1')
    expect(loadIntakeDraft('u1', d.savedAt)).toBeNull()
  })

  it('ignores something it cannot read', () => {
    localStorage.setItem(intakeDraftKey('u1'), '{not json')
    expect(loadIntakeDraft('u1')).toBeNull()
    localStorage.setItem(intakeDraftKey('u1'), JSON.stringify({ v: 2 }))
    expect(loadIntakeDraft('u1')).toBeNull()
  })

  it('says what it holds and how old it is, in plain words', () => {
    expect(draftSummary(draft())).toBe('Indus Textile Mills, 1 item')
    expect(draftSummary(draft({ company: null, items: [] }))).toBe('No company yet, no items yet')
    const at = Date.UTC(2026, 10, 27, 5, 42) // 10:42 in Karachi
    expect(draftAge(at, at + 60_000)).toBe('10:42 today')
    expect(draftAge(at, at + 86_400_000)).toBe('yesterday')
    expect(draftAge(at, at + 3 * 86_400_000)).toBe('3 days ago')
  })

  it('uses the key prefix that sign-out clears (security review L-5), and sign-out clears it', async () => {
    expect(INTAKE_DRAFT_KEYS).toBe(INTAKE_DRAFT_PREFIX)
    saveIntakeDraft('u1', draft())
    localStorage.setItem('qtech.channel.u1', 'email')
    await forgetDeviceCaptures()
    expect(localStorage.getItem(intakeDraftKey('u1'))).toBeNull()
    expect(localStorage.getItem('qtech.channel.u1')).toBe('email') // only the drafts go
  })
})
