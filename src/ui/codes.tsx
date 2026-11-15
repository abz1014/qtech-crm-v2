import { Fragment, type ReactNode } from 'react'

/** A document or record code: QT-26-0012, ORD-0002, INV-FA687z4jbo, RFQ-0001 R0. */
const CODE = /\b[A-Z]{2,5}(?:-[A-Za-z0-9]+)+(?: R\d+)?\b/g

/**
 * Text whose codes never break inside (audit 2: "QT-26- / 0001", "Invoice INV- / FA687z4jbo"): each code is kept on one line;
 * the text around it wraps as usual. The words read the same (textContent is unchanged). Anything but a string is passed through.
 */
export function keepCodes(text: ReactNode): ReactNode {
  if (typeof text !== 'string') return text
  const parts: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(CODE)) {
    const at = m.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    parts.push(
      <span key={at} className="whitespace-nowrap">
        {m[0]}
      </span>,
    )
    last = at + m[0].length
  }
  if (parts.length === 0) return text
  if (last < text.length) parts.push(text.slice(last))
  return <Fragment>{parts}</Fragment>
}
