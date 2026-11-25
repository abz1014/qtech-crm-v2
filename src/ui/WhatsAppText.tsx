import { whatsappParts } from '@/lib/whatsappText'

/**
 * A prepared WhatsApp message as it will read in WhatsApp: *bold* drawn bold, the asterisks not drawn. Only the
 * screen changes: pass the same text to Copy and MessageActions so the message sent keeps its formatting.
 */
export function WhatsAppText({ text }: { text: string }) {
  return (
    <>
      {whatsappParts(text).map((p, i) =>
        p.bold ? (
          <b key={i} className="font-semibold">
            {p.text}
          </b>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}
