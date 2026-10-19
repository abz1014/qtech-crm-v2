import { describe, expect, it } from 'vitest'
import { ENQUIRY_CORPUS } from './__fixtures__/enquiryCorpus'
import { parsePaste } from './parseItems'

// Audit E1: polite openers ("Please quote 2 nos ...") must not swallow the item.
describe('enquiry corpus (synthetic Pakistani B2B enquiries)', () => {
  it('has at least 25 cases', () => {
    expect(ENQUIRY_CORPUS.length).toBeGreaterThanOrEqual(25)
  })

  it.each(ENQUIRY_CORPUS.map(c => [c.name, c] as const))('%s', (_n, c) => {
    expect(parsePaste(c.text).items).toEqual(c.items)
  })

  it('reports accuracy', () => {
    const ok = ENQUIRY_CORPUS.filter(c => JSON.stringify(parsePaste(c.text).items) === JSON.stringify(c.items)).length
    console.log(`CORPUS_ACCURACY ${ok}/${ENQUIRY_CORPUS.length}`)
    expect(ok).toBe(ENQUIRY_CORPUS.length)
  })
})
