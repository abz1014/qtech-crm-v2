// The corpus's document model: one fictional enquiry or quotation, described once as blocks, then written out as the text a
// person pastes (text.ts), a PDF (pdf.ts) or a picture (html.ts, rendered and photographed by e2e/docread/corpus.spec.ts).
// The truth (what the reader must find) is kept beside it, never derived from a rendering.

export type Align = 'l' | 'r' | 'c'

export type Block =
  | { k: 'text'; text: string; bold?: boolean; size?: number; align?: 'left' | 'center' | 'right'; indent?: number }
  | { k: 'gap' }
  /** One line with a left and a right part (a letterhead or an ERP header in two columns). */
  | { k: 'pair'; left: string; right: string }
  | {
      k: 'table'
      /** Null: no header row (the Outlook RFQ). */
      head: string[] | null
      rows: string[][]
      /** Column widths as fractions of the text width. */
      widths: number[]
      align: Align[]
      ruled: boolean
      /** The column whose text wraps when it is too long. */
      descCol: number
      shaded?: boolean
      /** Rows under the table (totals), drawn in the same columns. */
      foot?: string[][]
      size?: number
    }
  | { k: 'chat'; msgs: ChatMsg[] }
  | { k: 'pagebreak' }

export interface ChatMsg {
  date: string
  /** "10:42" (24 h) */
  time: string
  name: string
  lines: string[]
  /** Our own message (right-hand bubble). */
  out?: boolean
  media?: 'voice' | 'image' | 'deleted' | 'document'
}

export interface Doc {
  /** What it looks like: an email, a printed form or letter, a chat, a spreadsheet. */
  look: 'email' | 'paper' | 'chat' | 'sheet'
  email?: { from: string; sent: string; to: string; cc?: string; subject: string }
  blocks: Block[]
  /** PDF only. */
  page?: {
    font?: 'helvetica' | 'times' | 'courier'
    size?: number
    /** Repeated at the top of every page. */
    letterhead?: Block[]
    /** "Page {n} of {m}" style footer. */
    footer?: string
    /** 90: a portrait page shown as landscape by the viewer (/Rotate 90), the text drawn to read upright. */
    rotate?: 0 | 90
    /** The page lies on its side with no /Rotate: the text runs up the page as the viewer shows it. */
    sideways?: boolean
    /** A large word drawn diagonally across every page ("COPY"). */
    watermark?: string
    landscape?: boolean
    /** Rows per page for a long table (forces a multi-page table). */
    rowsPerPage?: number
    /** Repeat the table header on every page. */
    repeatHead?: boolean
  }
}

export interface ItemTruth {
  description: string
  qty: number
  /** The customer's unit as written; null when they wrote none. */
  unit: string | null
  /** A part or model number that must come back exactly. */
  part?: string
}

export interface EnquiryTruth {
  items: ItemTruth[]
  ref?: string
  /** YYYY-MM-DD */
  due?: string
  company?: string
  domain?: string
}

export interface QuoteLineTruth {
  itemId: string
  unitPrice: number
  currency: string
  /** The longest lead time in days ("4-6 weeks" = 42), when the line or the quote gives one. */
  leadMax?: number
  validityDays?: number
}

export interface QuoteTruth {
  lines: QuoteLineTruth[]
  /** RFQ items the supplier did not price. */
  unpriced: string[]
  currency: string
  validityDays?: number
  payment?: string
  incoterm?: string
  quoteRef?: string
}

export type Medium = 'text' | 'pdf' | 'image' | 'scan'

/** How a picture is taken: the screen or paper, the device, and what the camera does to it. */
export interface Shot {
  /** The app or paper it imitates. */
  ui: 'outlook' | 'gmail' | 'paper' | 'excel' | 'whatsapp'
  width: number
  scale: number
  font: string
  dark?: boolean
  format: 'png' | 'jpeg' | 'webp'
  quality?: number
  /** Degrees of tilt (a phone photo). */
  tilt?: number
  blur?: number
  /** A soft shadow across part of the picture. */
  shadow?: boolean
  /** Contrast multiplier under 1. */
  contrast?: number
  /** A phone photo of a printed page or a screen: paper or screen texture, perspective. */
  photo?: boolean
  /** Phone screen (narrow viewport). */
  phone?: boolean
}

export interface TextStyle {
  table: 'tab' | 'cells' | 'spaces' | 'pipes'
  chat: 'android' | 'ios' | 'web'
}

interface CaseBase {
  id: string
  /** Generation of the template set (0: the first set; later sets are written after the reader was tuned). */
  gen: number
  batch: number
  split: 'dev' | 'held'
  shape: string
  medium: Medium
  doc: Doc
  textStyle: TextStyle
  shot?: Shot
}

export interface EnquiryCase extends CaseBase {
  kind: 'enquiry'
  truth: EnquiryTruth
}

export interface QuoteCase extends CaseBase {
  kind: 'quote'
  /** The RFQ the quote answers. */
  rfq: Array<{ id: string; description: string; model?: string | null; qty: number; unit?: string | null }>
  truth: QuoteTruth
}

export type CorpusCase = EnquiryCase | QuoteCase
