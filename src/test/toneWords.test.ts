import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { sourceFiles, SRC, visibleStrings } from '@/test/visibleStrings'

/*
 * Tone guard (docs/design/TONE-REVIEW.md, rules 1 to 15). It counts, per source file, the visible strings (string and template
 * literals and JSX text, read the same way as oneName.test.ts) that break a rule a machine can check:
 *
 *   contractions   "can't", "You're", "it's": rule 5, no contractions
 *   curly          a curly apostrophe: rule 5, one straight apostrophe style
 *   rupees         "Rs 500": rule 14, PKR never Rs
 *   gotIt          "Got it": rule 8, a button names its action
 *   chase          chase, chased, chasing, nudge: the glossary says Follow up or Send reminder
 *   tap            tap, taps, tapped: rule 13, device-neutral verbs
 *   signal         "signal": rule 13, No connection
 *   enquiry        enquiry, enquiries, inquiry: the glossary says RFQ (customer-facing text keeps "enquiry", see ENQUIRY_OK)
 *   client         client: the glossary says customer
 *   somethingWrong a string that is only "Something went wrong": rule 9, say what did not happen and what to do
 *   exclaim        "!" in a sentence: rule 4
 *   semicolon      "; " in a sentence: rule 12, one sentence one idea
 *
 * The counts are compared with src/test/toneBaseline.json, the counts on the day the rewrite started. The test fails only when a
 * file's count goes UP, so the words can only shrink. A lane that rewrites a screen never edits the baseline: the last lane sets
 * every count to zero. To rebuild the baseline (and only then): UPDATE_TONE_BASELINE=1 npx vitest run src/test/toneWords.test.ts
 */

type Rule = { name: string; test: (s: string) => boolean }

const rules: Rule[] = [
  { name: 'contractions', test: s => /\b\w+n['’]t\b|\b(?:you|we|they|I)['’](?:re|ll|ve|d|m)\b|\b(?:it|that|there|what|here|let|who|he|she)['’]s\b/i.test(s) },
  { name: 'curly', test: s => /[’‘]/.test(s) },
  { name: 'rupees', test: s => /\bRs\.? ?\d/.test(s) },
  { name: 'gotIt', test: s => /\bGot it\b/.test(s) },
  { name: 'chase', test: s => /(?<![\w-])(?:chase[sd]?|chasing|nudg\w*)(?![\w-])/i.test(s) },
  { name: 'tap', test: s => /\btap(?:s|ped|ping)?\b/i.test(s) },
  { name: 'signal', test: s => /\bsignal\b/i.test(s) },
  { name: 'enquiry', test: s => /\b(?:enquir(?:y|ies)|inquir(?:y|ies))\b/i.test(s) },
  { name: 'client', test: s => /(?<![\w/-])clients?(?![\w-])/i.test(s) },
  { name: 'somethingWrong', test: s => /^\s*Something went wrong\.?\s*$/i.test(s) },
  { name: 'exclaim', test: s => /!(?!=)/.test(s.replace(/\(\?!/g, '')) },
  { name: 'semicolon', test: s => /;\s/.test(s.replace(/&[a-z]+;/gi, '')) },
]

/**
 * Files whose "enquiry" is for a customer or a supplier to read (messages that are copied out, printed documents, the document
 * reader, which looks for the word in what customers send). Not counted for the `enquiry` rule.
 */
const ENQUIRY_OK = [
  /\/pdf\//,
  /^lib\/docread\//,
  /^features\/rfqs\/lib\/(customerChase|supplierChase|goodsChase|paymentReminder|enquiryDraft|parseItems|replyParse|replyPrice)\.ts$/,
]

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/')
const BASELINE = path.join(SRC, 'test', 'toneBaseline.json')
/** Files with no words on screen: generated database types. */
const NOT_UI = ['types/']

type Counts = Record<string, Record<string, number>>

function count(): Counts {
  const out: Counts = {}
  for (const file of sourceFiles(SRC)) {
    const r = rel(file)
    if (NOT_UI.some(n => r.startsWith(n))) continue
    const mine: Record<string, number> = {}
    for (const pieces of visibleStrings(file)) {
      const s = pieces.map(p => (typeof p === 'string' ? p : '{}')).join('')
      if (!s.trim()) continue
      for (const rule of rules) {
        if (rule.name === 'enquiry' && ENQUIRY_OK.some(re => re.test(r))) continue
        if (rule.test(s)) mine[rule.name] = (mine[rule.name] ?? 0) + 1
      }
    }
    if (Object.keys(mine).length) out[r] = mine
  }
  return out
}

let counted: Counts | null = null

describe('tone words (no file may add a retired word or a casual form)', () => {
  beforeAll(() => {
    counted = count()
    if (process.env.UPDATE_TONE_BASELINE === '1') writeFileSync(BASELINE, JSON.stringify(counted, null, 2) + '\n')
  }, 180_000)

  it('no file has more of any counted word than the baseline', () => {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Counts
    const more: string[] = []
    for (const [file, mine] of Object.entries(counted!)) {
      for (const [name, n] of Object.entries(mine)) {
        const was = baseline[file]?.[name] ?? 0
        if (n > was) more.push(`${file}: ${n} string(s) with "${name}", the baseline allows ${was}. See docs/design/TONE-REVIEW.md.`)
      }
    }
    expect(more).toEqual([])
  })

  it('the baseline names only files that exist and counts that are whole numbers', () => {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Counts
    const known = new Set(rules.map(r => r.name))
    for (const [file, mine] of Object.entries(baseline)) {
      for (const [name, n] of Object.entries(mine)) {
        expect(known.has(name), `${file}: unknown rule ${name}`).toBe(true)
        expect(Number.isInteger(n) && n > 0, `${file}: ${name} is ${n}`).toBe(true)
      }
    }
  })
})
