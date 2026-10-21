// A corpus document as the text a person pastes: an email body copied whole (Outlook puts a table's cells between tabs), a
// WhatsApp chat exported or copied (each phone writes its own prefix), a PDF's text copied from a viewer (columns as spaces).

import type { Block, ChatMsg, Doc, TextStyle } from './model'

function pad(s: string, n: number, right: boolean): string {
  return right ? s.padStart(n) : s.padEnd(n)
}

function tableText(b: Extract<Block, { k: 'table' }>, style: TextStyle['table']): string[] {
  const rows = [...(b.head ? [b.head] : []), ...b.rows, ...(b.foot ?? [])]
  switch (style) {
    case 'tab':
      return rows.map(r => r.join('\t'))
    case 'pipes':
      return rows.map(r => `| ${r.join(' | ')} |`)
    case 'cells':
      return rows.flatMap(r => r.filter(c => c !== ''))
    case 'spaces': {
      const w = rows[0]?.map((_, i) => Math.max(...rows.map(r => (r[i] ?? '').length))) ?? []
      return rows.map(r => r.map((c, i) => pad(c, w[i] ?? 0, b.align[i] === 'r')).join('    ').replace(/\s+$/, ''))
    }
  }
}

const VOICE = { android: '<Media omitted>', ios: '‎audio omitted', web: 'PTT-20261019-WA0007.opus (file attached)' }
const IMAGE = { android: '<Media omitted>', ios: '‎image omitted', web: 'IMG-20261019-WA0012.jpg (file attached)' }

function chatText(msgs: ChatMsg[], style: TextStyle['chat']): string[] {
  const out: string[] = []
  for (const m of msgs) {
    const [h, mi] = m.time.split(':').map(Number) as [number, number]
    const ampm = `${((h + 11) % 12) + 1}:${String(mi).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
    const prefix =
      style === 'android' ? `${m.date}, ${ampm} - ${m.name}: ` : style === 'ios' ? `[${m.date}, ${m.time}:${String((h * 7 + mi) % 60).padStart(2, '0')}] ${m.name}: ` : `[${m.time}, ${m.date}] ${m.name}: `
    const body =
      m.media === 'voice' ? [VOICE[style]] : m.media === 'image' ? [IMAGE[style]] : m.media === 'deleted' ? ['This message was deleted'] : m.media === 'document' ? ['RFQ-list.pdf (file attached)'] : m.lines
    body.forEach((l, i) => out.push(i === 0 ? `${prefix}${l}` : l))
  }
  return out
}

export function docText(doc: Doc, style: TextStyle): string {
  const out: string[] = []
  if (doc.email) {
    out.push(`From: ${doc.email.from}`, `Sent: ${doc.email.sent}`, `To: ${doc.email.to}`)
    if (doc.email.cc) out.push(`Cc: ${doc.email.cc}`)
    out.push(`Subject: ${doc.email.subject}`, '')
  }
  const blocks = [...(doc.page?.letterhead ?? []), ...doc.blocks]
  for (const b of blocks) {
    switch (b.k) {
      case 'text':
        out.push(`${' '.repeat(b.indent ?? 0)}${b.text}`)
        break
      case 'gap':
        out.push('')
        break
      case 'pair':
        out.push(b.left ? `${b.left}        ${b.right}` : b.right)
        break
      case 'table':
        out.push(...tableText(b, style.table))
        break
      case 'chat':
        out.push(...chatText(b.msgs, style.chat))
        break
      case 'pagebreak':
        out.push('')
        break
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
