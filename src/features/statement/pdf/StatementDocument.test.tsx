import path from 'node:path'
import { Font, renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import { buildStatement } from '@/features/statement/model'
import { StatementDocument } from '@/features/statement/pdf/StatementDocument'
import { PROFILE, sampleData } from '@/features/statement/testFixture'

/*
 * The comparative statement PDF really renders (react-pdf in Node, the app's Geist faces from @fontsource): A4 landscape, over
 * several pages, with the column headings repeated and a page number on each. Synthetic data only. Setting STATEMENT_SAMPLE_PDF to a
 * path also writes the file there, for looking at.
 */
const files = path.resolve(__dirname, '../../../../node_modules/@fontsource')
Font.register({
  family: 'Geist',
  fonts: [400, 500, 600].map(w => ({ src: path.join(files, `geist-sans/files/geist-sans-latin-${w}-normal.woff`), fontWeight: w })),
})
Font.register({
  family: 'Geist Mono',
  fonts: [400, 500].map(w => ({ src: path.join(files, `geist-mono/files/geist-mono-latin-${w}-normal.woff`), fontWeight: w })),
})
Font.registerHyphenationCallback(word => [word])

// a 1 x 1 transparent PNG stands in for the wordmark
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const pages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length

describe('StatementDocument', () => {
  it('renders a multi-page A4 landscape statement', async () => {
    const buf = await renderToBuffer(<StatementDocument data={sampleData(24)} profile={PROFILE} logoSrc={LOGO} />)
    const text = buf.toString('latin1')
    expect(text.startsWith('%PDF')).toBe(true)
    expect(pages(buf)).toBeGreaterThan(1)
    // A4 landscape: the media box is 841.89 wide and 595.28 tall
    expect(text).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+841\.89\d*\s+595\.28\d*\s*\]/)
    if (process.env.STATEMENT_SAMPLE_PDF) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(process.env.STATEMENT_SAMPLE_PDF, buf)
    }
  }, 60_000)

  it('renders a short statement (the item and the totals), and one with nothing quoted yet', async () => {
    const one = await renderToBuffer(<StatementDocument data={sampleData(1, false)} profile={PROFILE} logoSrc={LOGO} />)
    if (process.env.STATEMENT_SAMPLE_PDF) (await import('node:fs')).writeFileSync(`${process.env.STATEMENT_SAMPLE_PDF}.small.pdf`, one)
    expect(pages(one)).toBeLessThanOrEqual(2)
    const empty = sampleData(2, false)
    empty.statement = buildStatement([], [])
    const none = await renderToBuffer(<StatementDocument data={empty} profile={PROFILE} logoSrc={LOGO} />)
    expect(none.toString('latin1').startsWith('%PDF')).toBe(true)
  }, 60_000)
})
