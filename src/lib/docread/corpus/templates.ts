// Every template, tagged with its generation. Generation 0 was written before tuning; each later generation was written after
// the reader passed the batches before it, and first checked on a fresh batch (corpus.ts BATCHES).

import { ENQUIRY_TEMPLATES_GEN0, type EnquiryTemplate } from './enquiries'
import { ENQUIRY_TEMPLATES_GEN1, QUOTE_TEMPLATES_GEN1 } from './gen1'
import { ENQUIRY_TEMPLATES_GEN2, QUOTE_TEMPLATES_GEN2 } from './gen2'
import { ENQUIRY_TEMPLATES_GEN3, QUOTE_TEMPLATES_GEN3 } from './gen3'
import { ENQUIRY_TEMPLATES_GEN4, QUOTE_TEMPLATES_GEN4 } from './gen4'
import { ENQUIRY_TEMPLATES_GEN5, QUOTE_TEMPLATES_GEN5 } from './gen5'
import { ENQUIRY_TEMPLATES_GEN6, QUOTE_TEMPLATES_GEN6 } from './gen6'
import { ENQUIRY_TEMPLATES_GEN7, QUOTE_TEMPLATES_GEN7 } from './gen7'
import { ENQUIRY_TEMPLATES_GEN8, ENQUIRY_TEMPLATES_GEN9, QUOTE_TEMPLATES_GEN8, QUOTE_TEMPLATES_GEN9 } from './gen8'
import { ENQUIRY_TEMPLATES_GEN10, ENQUIRY_TEMPLATES_GEN11, QUOTE_TEMPLATES_GEN10, QUOTE_TEMPLATES_GEN11 } from './gen10'
import { ENQUIRY_TEMPLATES_GEN12, ENQUIRY_TEMPLATES_GEN13, QUOTE_TEMPLATES_GEN12, QUOTE_TEMPLATES_GEN13 } from './gen12'
import { QUOTE_TEMPLATES_GEN0, type QuoteTemplate } from './quotes'

export const ENQUIRY_TEMPLATES: Array<{ shape: string; make: EnquiryTemplate; weight: number; gen: number }> = [
  ...ENQUIRY_TEMPLATES_GEN0.map(t => ({ ...t, gen: 0 })),
  ...ENQUIRY_TEMPLATES_GEN1.map(t => ({ ...t, gen: 1 })),
  ...ENQUIRY_TEMPLATES_GEN2.map(t => ({ ...t, gen: 2 })),
  ...ENQUIRY_TEMPLATES_GEN3.map(t => ({ ...t, gen: 3 })),
  ...ENQUIRY_TEMPLATES_GEN4.map(t => ({ ...t, gen: 4 })),
  ...ENQUIRY_TEMPLATES_GEN5.map(t => ({ ...t, gen: 5 })),
  ...ENQUIRY_TEMPLATES_GEN6.map(t => ({ ...t, gen: 6 })),
  ...ENQUIRY_TEMPLATES_GEN7.map(t => ({ ...t, gen: 7 })),
  ...ENQUIRY_TEMPLATES_GEN8.map(t => ({ ...t, gen: 8 })),
  ...ENQUIRY_TEMPLATES_GEN9.map(t => ({ ...t, gen: 9 })),
  ...ENQUIRY_TEMPLATES_GEN10.map(t => ({ ...t, gen: 10 })),
  ...ENQUIRY_TEMPLATES_GEN11.map(t => ({ ...t, gen: 11 })),
  ...ENQUIRY_TEMPLATES_GEN12.map(t => ({ ...t, gen: 12 })),
  ...ENQUIRY_TEMPLATES_GEN13.map(t => ({ ...t, gen: 13 })),
]

export const QUOTE_TEMPLATES: Array<{ shape: string; make: QuoteTemplate; weight: number; gen: number }> = [
  ...QUOTE_TEMPLATES_GEN0.map(t => ({ ...t, gen: 0 })),
  ...QUOTE_TEMPLATES_GEN1.map(t => ({ ...t, gen: 1 })),
  ...QUOTE_TEMPLATES_GEN2.map(t => ({ ...t, gen: 2 })),
  ...QUOTE_TEMPLATES_GEN3.map(t => ({ ...t, gen: 3 })),
  ...QUOTE_TEMPLATES_GEN4.map(t => ({ ...t, gen: 4 })),
  ...QUOTE_TEMPLATES_GEN5.map(t => ({ ...t, gen: 5 })),
  ...QUOTE_TEMPLATES_GEN6.map(t => ({ ...t, gen: 6 })),
  ...QUOTE_TEMPLATES_GEN7.map(t => ({ ...t, gen: 7 })),
  ...QUOTE_TEMPLATES_GEN8.map(t => ({ ...t, gen: 8 })),
  ...QUOTE_TEMPLATES_GEN9.map(t => ({ ...t, gen: 9 })),
  ...QUOTE_TEMPLATES_GEN10.map(t => ({ ...t, gen: 10 })),
  ...QUOTE_TEMPLATES_GEN11.map(t => ({ ...t, gen: 11 })),
  ...QUOTE_TEMPLATES_GEN12.map(t => ({ ...t, gen: 12 })),
  ...QUOTE_TEMPLATES_GEN13.map(t => ({ ...t, gen: 13 })),
]
