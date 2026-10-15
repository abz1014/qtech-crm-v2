import { FilePlus2, FileText, ListPlus, MessageCircleQuestion, ScanText, type LucideIcon } from 'lucide-react'
import type { Dest } from '@/features/capture/model'

/** The destination tiles of the Capture sheet: glyph, title and the one-line help (g2-capture.html). */
export const TILES: Record<Dest, { icon: LucideIcon; title: string; help: string }> = {
  answer: { icon: MessageCircleQuestion, title: 'Answer a question', help: 'The customer replied to what we asked' },
  questions: { icon: ListPlus, title: 'New supplier questions', help: 'One question per line' },
  notes: { icon: FileText, title: 'Add to RFQ notes', help: 'Keep it with the RFQ as written' },
  'new-rfq': { icon: FilePlus2, title: 'Start a new RFQ', help: 'Begin intake with this text' },
  reply: { icon: ScanText, title: 'Supplier reply', help: 'Read the prices from their message' },
}
