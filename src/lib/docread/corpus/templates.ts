// Every template, tagged with its generation. Generation 0 was written before tuning; each later generation was written after
// the reader passed the batches before it, and first checked on a fresh batch (corpus.ts BATCHES).

import { ENQUIRY_TEMPLATES_GEN0, type EnquiryTemplate } from './enquiries'
import { ENQUIRY_TEMPLATES_GEN1, QUOTE_TEMPLATES_GEN1 } from './gen1'
import { ENQUIRY_TEMPLATES_GEN2, QUOTE_TEMPLATES_GEN2 } from './gen2'
import { QUOTE_TEMPLATES_GEN0, type QuoteTemplate } from './quotes'

export const ENQUIRY_TEMPLATES: Array<{ shape: string; make: EnquiryTemplate; weight: number; gen: number }> = [
  ...ENQUIRY_TEMPLATES_GEN0.map(t => ({ ...t, gen: 0 })),
  ...ENQUIRY_TEMPLATES_GEN1.map(t => ({ ...t, gen: 1 })),
  ...ENQUIRY_TEMPLATES_GEN2.map(t => ({ ...t, gen: 2 })),
]

export const QUOTE_TEMPLATES: Array<{ shape: string; make: QuoteTemplate; weight: number; gen: number }> = [
  ...QUOTE_TEMPLATES_GEN0.map(t => ({ ...t, gen: 0 })),
  ...QUOTE_TEMPLATES_GEN1.map(t => ({ ...t, gen: 1 })),
  ...QUOTE_TEMPLATES_GEN2.map(t => ({ ...t, gen: 2 })),
]
