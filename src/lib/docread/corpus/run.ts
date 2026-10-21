// Runs the reader over corpus cases in Node: pasted text straight to the parser, PDFs through pdf.js (readPdfText) first.
// Pictures and scans need a browser (e2e/docread/corpus.spec.ts); here they are scored from the text that spec saved
// (`ocrText`), when given.

import { parseEnquiry } from '../enquiryParse'
import { readPdfText } from '../pdfText'
import { parseSupplierQuote } from '../supplierQuoteParse'
import { CORPUS_TODAY } from './corpus'
import type { CorpusCase } from './model'
import { docPdf } from './pdf'
import { enquiryResult, quoteResult } from './results'
import { scoreEnquiry, scoreQuote, type CaseScore } from './score'
import { docText } from './text'

export interface CaseRun {
  score: CaseScore
  /** The text the parser was given. */
  text: string
}

/** The parser's verdict on one text, scored. */
export function scoreText(c: CorpusCase, text: string): CaseScore {
  if (c.kind === 'enquiry') return scoreEnquiry(c, enquiryResult(parseEnquiry(text, { today: CORPUS_TODAY })))
  return scoreQuote(c, quoteResult(parseSupplierQuote(text, c.rfq, { today: CORPUS_TODAY })))
}

export async function runCase(c: CorpusCase, ocrText?: Map<string, string>): Promise<CaseRun | null> {
  let text: string
  if (c.medium === 'text') text = docText(c.doc, c.textStyle)
  else if (c.medium === 'pdf') {
    const pdf = await readPdfText(await docPdf(c.doc))
    text = pdf.ok ? pdf.text : ''
  } else {
    const t = ocrText?.get(c.id)
    if (t === undefined) return null
    text = t
  }
  return { score: scoreText(c, text), text }
}
