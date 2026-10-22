import { FilePlus, ListPlus, MessageCircleQuestion, MessageSquareReply, StickyNote, type LucideIcon } from 'lucide-react'
import type { Dest } from '@/features/capture/model'

/** The destinations drawn as one of the four tiles (g2-capture.html, "The destinations"). The rest sit under "Something else". */
export type TileDest = Exclude<Dest, 'questions' | 'order'>

/**
 * The four destination tiles of the Capture sheet: glyph, title and the one-line help. A supplier's reply with prices is the
 * commonest paste after an answer, so it has a tile (grade-B K2); "Questions from a supplier" moved under "Something else".
 */
export const TILES: Record<TileDest, { icon: LucideIcon; title: string; help: string }> = {
  answer: { icon: MessageCircleQuestion, title: 'Answer a question', help: 'The customer replied to what we asked' },
  reply: { icon: MessageSquareReply, title: 'A supplier’s prices', help: 'Their reply, read out on the RFQ' },
  notes: { icon: StickyNote, title: 'Add to RFQ notes', help: 'Keep it with the RFQ as written' },
  'new-rfq': { icon: FilePlus, title: 'Start a new RFQ', help: 'Read the items from this text' },
}

/** "Questions from a supplier", chosen from "Something else" (and drawn as the chosen card when picked or guessed). */
export const QUESTIONS_DEST = { icon: ListPlus, title: 'Questions from a supplier', help: 'One question per line' } as const
