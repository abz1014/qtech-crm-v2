/*
 * What the cancel dialog says about a purchase order that was already sent (audit P2), and the message that asks the supplier to cancel.
 * One module so the sentence and the WhatsApp text cannot drift apart. No prices, only the PO, the items and the polite request.
 */
export interface SentPo {
  /** 'PO-26-0017' */
  ref: string
  supplierName: string
  items: Array<{ description: string; qty: number; unit: string | null }>
}

/** "PO-26-0017 was sent to Alpenmark. Tell them it's cancelled." One sentence per PO. */
export const sentPoSentence = (po: SentPo): string => `${po.ref} was sent to ${po.supplierName}. Tell them it's cancelled.`

const qtyText = (i: SentPo['items'][number]): string => `${i.qty}${i.unit ? ` ${i.unit}` : ''}`

/** The WhatsApp-style message for one supplier. */
export function cancellationMessage(po: SentPo, ourName: string): string {
  const lines = po.items.map((i, n) => `${n + 1}. ${i.description}, ${qtyText(i)}`)
  return [
    'Assalam o Alaikum,',
    '',
    `Regarding our purchase order *${po.ref}*: our customer has cancelled the order, so we have to ask you to cancel it as well.`,
    ...(lines.length ? ['', 'It covered:', ...lines] : []),
    '',
    'If anything has already been ordered or shipped, please let us know so we can sort it out together. Sorry for the trouble, and thank you for your understanding.',
    '',
    'Regards,',
    ourName,
  ].join('\n')
}
