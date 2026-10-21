// Every template, tagged with its generation. Generation 0 was written before tuning; each later generation was written after
// the reader passed the batches before it, and first checked on a fresh batch (corpus.ts BATCHES).

import { ENQUIRY_TEMPLATES_GEN0, type EnquiryTemplate } from './enquiries'
import { QUOTE_TEMPLATES_GEN0, type QuoteTemplate } from './quotes'

export const ENQUIRY_TEMPLATES: Array<{ shape: string; make: EnquiryTemplate; weight: number; gen: number }> = [...ENQUIRY_TEMPLATES_GEN0.map(t => ({ ...t, gen: 0 }))]

export const QUOTE_TEMPLATES: Array<{ shape: string; make: QuoteTemplate; weight: number; gen: number }> = [...QUOTE_TEMPLATES_GEN0.map(t => ({ ...t, gen: 0 }))]
