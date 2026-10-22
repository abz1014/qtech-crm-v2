// The reader's accuracy gate (CI job "build", step "Unit tests"): the fictional corpus (corpus.ts) through the real parsers,
// pasted text and PDFs here; pictures and scans in e2e/docread/corpus.spec.ts. Fails when any field of any set or shape drops
// below its floor in floor.text.json (gate.ts); the owner's bars (dev 100% items/qty/unit, every field >= 98%, every shape
// >= 95%) are printed beside it.
// Local runs:  npx vitest run src/lib/docread/corpus
//   CORPUS_BATCHES=0,1       the batches to run (default 0,1,2: batch 0 is dev + held-out, the others fresh, all held out)
//   CORPUS_OCR=<file.json>   the text the picture reader gave for image and scan cases ({ id: text }), from the e2e spec
//   CORPUS_OUT=<file.md>     write the report and every dev case's problems there (held-out cases are measured, never shown)
//   CORPUS_WRITE_FLOOR=1     record this run's values as the new floors
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { BATCHES, batch } from './corpus'
import { dropped, evaluate, type Scored } from './gate'
import { runCase } from './run'

beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
})

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const RUN = (env.CORPUS_BATCHES ?? BATCHES.filter(b => b.gate).map(b => b.batch).join(',')).split(',').map(Number)
const OCR = env.CORPUS_OCR && existsSync(env.CORPUS_OCR) ? new Map(Object.entries(JSON.parse(readFileSync(env.CORPUS_OCR, 'utf8')) as Record<string, string>)) : undefined
const FLOOR_FILE = 'src/lib/docread/corpus/floor.text.json'

describe('reader corpus', () => {
  it('reads the fictional corpus at or above every recorded floor', async () => {
    const scores: Scored[] = []
    const texts = new Map<string, string>()
    for (const b of RUN) {
      for (const c of batch(b)) {
        const run = await runCase(c, OCR)
        if (!run) continue
        texts.set(c.id, run.text)
        scores.push({ ...run.score, batch: b, kind: c.kind })
      }
    }
    const g = evaluate(scores, 'text and PDF')
    const floor = JSON.parse(readFileSync(FLOOR_FILE, 'utf8')) as Record<string, number>
    const drops = dropped(g.values, floor)
    if (env.CORPUS_WRITE_FLOOR === '1') writeFileSync(FLOOR_FILE, `${JSON.stringify(Object.fromEntries(Object.entries({ ...floor, ...g.values }).sort()), null, 2)}\n`)
    // Only dev cases are written out in full: held-out and fresh cases are measured, never looked into (no tuning on them).
    const bad = scores.filter(s => !s.perfect && (s.split === 'dev' || env.CORPUS_SHOW_HELD === '1'))
    const detail = bad.map(s => [`#### ${s.id} ${s.shape} ${s.medium} ${s.split}`, ...s.problems.map(p => `- ${p}`), '```', texts.get(s.id) ?? '', '```'].join('\n'))
    const summary = [...g.report, g.belowBars.length ? `Below the owner's bars:\n${g.belowBars.join('\n')}` : "All owner's bars met.", drops.length ? `BELOW FLOOR:\n${drops.join('\n')}` : 'No field below its floor.']
    if (env.CORPUS_OUT) writeFileSync(env.CORPUS_OUT, [...summary, '## Cases', ...detail].join('\n'))
    console.log(summary.join('\n'))
    const gh = env.GITHUB_STEP_SUMMARY
    if (gh) writeFileSync(gh, `${summary.join('\n')}\n`, { flag: 'a' })
    expect(drops).toEqual([])
  }, 600_000)
})
