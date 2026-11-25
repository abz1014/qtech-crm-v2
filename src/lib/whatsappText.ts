/*
 * WhatsApp formatting, for showing a prepared message on screen (screen review 2026-11-24, item 19). Text between single
 * asterisks is bold once pasted into WhatsApp ("*PI-123*"). On screen the words are drawn bold and the asterisks are
 * not; the text copied or opened in WhatsApp keeps them.
 */
export interface WhatsAppPart {
  text: string
  bold: boolean
}

const BOLD = /(\*[^*\n]+\*)/g

/** "Invoice *PI-123* is due" -> [Invoice ][PI-123 bold][ is due]. A lone or empty "*" is left as typed. */
export function whatsappParts(text: string): WhatsAppPart[] {
  return text
    .split(BOLD)
    .filter(p => p !== '')
    .map(p => (/^\*[^*\n]+\*$/.test(p) ? { text: p.slice(1, -1), bold: true } : { text: p, bold: false }))
}
