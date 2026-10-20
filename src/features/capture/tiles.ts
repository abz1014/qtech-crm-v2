import { FilePlus, ListPlus, MessageCircleQuestion, StickyNote, type LucideIcon } from 'lucide-react'
import type { Dest } from '@/features/capture/model'

/** The four destination tiles of the Capture sheet: glyph, title and the one-line help (g2-capture.html, "The destinations"). */
export const TILES: Record<Exclude<Dest, 'reply' | 'order'>, { icon: LucideIcon; title: string; help: string }> = {
  answer: { icon: MessageCircleQuestion, title: 'Answer a question', help: 'The customer replied to what we asked' },
  questions: { icon: ListPlus, title: 'Questions from a supplier', help: 'One question per line' },
  notes: { icon: StickyNote, title: 'Add to RFQ notes', help: 'Keep it with the RFQ as written' },
  'new-rfq': { icon: FilePlus, title: 'Start a new RFQ', help: 'Begin intake with this text' },
}
