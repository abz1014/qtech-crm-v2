// A corpus document as a web page for a picture: an Outlook or Gmail reading pane, a printed page (for a phone photo or a
// scan), a WhatsApp chat on a phone, an Excel range. e2e/docread/corpus.spec.ts renders it with Playwright, takes the screenshot,
// and then does to it what a camera does (tilt, blur, shadow, JPEG) before the picture reader gets it.

import type { Block, ChatMsg, Doc, Shot } from './model'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function tableHtml(b: Extract<Block, { k: 'table' }>, ui: Shot['ui']): string {
  const al = (i: number) => (b.align[i] === 'r' ? 'right' : b.align[i] === 'c' ? 'center' : 'left')
  const total = 1
  // Only the description column is given a width; the others take their contents' width.
  const col = b.widths.map((w, i) => (i === b.descCol ? `<col style="width:${Math.round((w / total) * 100)}%">` : '<col>')).join('')
  const cls = b.ruled ? 'ruled' : 'plain'
  const ws = (i: number) => (i === b.descCol ? '' : 'white-space:nowrap;')
  const head = b.head ? `<tr class="h">${b.head.map((c, i) => `<th style="text-align:${al(i)};white-space:nowrap">${esc(c)}</th>`).join('')}</tr>` : ''
  const rows = b.rows.map((r, k) => `<tr${b.shaded && k % 2 === 1 ? ' class="alt"' : ''}>${r.map((c, i) => `<td style="text-align:${al(i)};${ws(i)}">${esc(c)}</td>`).join('')}</tr>`).join('')
  const foot = (b.foot ?? []).map(r => `<tr class="f">${r.map((c, i) => `<td style="text-align:${al(i)};${ws(i)}">${esc(c)}</td>`).join('')}</tr>`).join('')
  const width = ui === 'outlook' || ui === 'gmail' ? (b.head ? '100%' : '78%') : '100%'
  return `<table class="${cls}" style="width:${width}"><colgroup>${col}</colgroup>${head}${rows}${foot}</table>`
}

function blocksHtml(blocks: Block[], ui: Shot['ui']): string {
  return blocks
    .map(b => {
      switch (b.k) {
        case 'text':
          return `<div style="${b.bold ? 'font-weight:bold;' : ''}${b.size ? `font-size:${(b.size / 9.5).toFixed(2)}em;` : ''}text-align:${b.align ?? 'left'};padding-left:${(b.indent ?? 0) * 0.5}em">${esc(b.text)}</div>`
        case 'gap':
          return '<div class="gap"></div>'
        case 'pair':
          return `<div class="pair"><span>${esc(b.left)}</span><span>${esc(b.right)}</span></div>`
        case 'table':
          return tableHtml(b, ui)
        case 'chat':
          return ''
        case 'pagebreak':
          return '<div class="gap"></div>'
      }
    })
    .join('')
}

function chatHtml(msgs: ChatMsg[], contact: string, shot: Shot): string {
  const dark = Boolean(shot.dark)
  const c = dark
    ? { bg: '#0b141a', bar: '#202c33', inBg: '#202c33', outBg: '#005c4b', fg: '#e9edef', muted: '#8696a0' }
    : { bg: '#efeae2', bar: '#008069', inBg: '#ffffff', outBg: '#d9fdd3', fg: '#111b21', muted: '#667781' }
  const bubble = (m: ChatMsg) => {
    const [h, mi] = m.time.split(':').map(Number) as [number, number]
    const t = `${((h + 11) % 12) + 1}:${String(mi).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
    const body =
      m.media === 'voice'
        ? `<div class="voice">▶ <span class="wave"></span> 0:${String(5 + (mi % 40)).padStart(2, '0')}</div>`
        : m.media === 'image'
          ? '<div class="img"></div>'
          : m.media === 'deleted'
            ? `<div style="font-style:italic;color:${c.muted}">⊘ This message was deleted</div>`
            : m.media === 'document'
              ? '<div class="doc">📄 RFQ-list.pdf</div>'
              : m.lines.map(l => `<div>${esc(l) || '&nbsp;'}</div>`).join('')
    return `<div class="b ${m.out ? 'out' : 'in'}">${body}<div class="t">${t}${m.out ? ' <span class="tick">✓✓</span>' : ''}</div></div>`
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; font-family: ${shot.font}; background: ${c.bg}; color: ${c.fg}; }
    .status { display: flex; justify-content: space-between; padding: 6px 16px; font-size: 14px; background: ${c.bar}; color: #fff; }
    .head { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: ${c.bar}; color: #fff; font-size: 17px; }
    .av { width: 36px; height: 36px; border-radius: 50%; background: #9aa; }
    .chat { padding: 10px 8px 70px; display: flex; flex-direction: column; gap: 6px; }
    .day { align-self: center; font-size: 12px; padding: 4px 10px; border-radius: 6px; background: ${c.inBg}; color: ${c.muted}; }
    .b { max-width: 84%; padding: 6px 8px 4px; border-radius: 8px; font-size: 15.5px; line-height: 21px; }
    .in { align-self: flex-start; background: ${c.inBg}; }
    .out { align-self: flex-end; background: ${c.outBg}; }
    .t { text-align: right; font-size: 11px; color: ${c.muted}; line-height: 14px; }
    .tick { color: #53bdeb; }
    .voice { display: flex; gap: 8px; align-items: center; color: ${c.muted}; }
    .wave { display: inline-block; width: 150px; height: 4px; background: ${c.muted}; border-radius: 2px; }
    .img { width: 220px; height: 140px; background: linear-gradient(135deg, #8a9, #cba); border-radius: 6px; }
    .bar { position: fixed; bottom: 0; left: 0; right: 0; padding: 8px; background: ${c.bg}; }
    .input { border-radius: 22px; padding: 11px 16px; background: ${c.inBg}; color: ${c.muted}; font-size: 16px; }
  </style></head><body>
    <div class="status"><span>9:41</span><span>4G 87%</span></div>
    <div class="head"><div class="av"></div><div><div>${esc(contact)}</div><div style="font-size:12px;opacity:.8">online</div></div></div>
    <div class="chat"><div class="day">Today</div>${msgs.map(bubble).join('')}</div>
    <div class="bar"><div class="input">Message</div></div>
  </body></html>`
}

export function docHtml(doc: Doc, shot: Shot): string {
  const chat = doc.blocks.find((b): b is Extract<Block, { k: 'chat' }> => b.k === 'chat')
  if (chat) {
    const other = chat.msgs.find(m => !m.out)?.name ?? 'Customer'
    return chatHtml(chat.msgs, other, shot)
  }
  const dark = Boolean(shot.dark)
  const fg = dark ? '#e6e6e6' : '#111'
  const bg = dark ? '#1f1f1f' : '#fff'
  const line = dark ? '#9a9a9a' : '#333'
  const size = shot.phone ? 15 : shot.ui === 'paper' ? 13 : 14.5
  let header = ''
  if (doc.email && shot.ui === 'outlook') {
    const e = doc.email
    header = `<div class="mh">${[
      ['From:', e.from],
      ['Sent:', e.sent],
      ['To:', e.to],
      ...(e.cc ? [['Cc:', e.cc]] : []),
      ['Subject:', e.subject],
    ]
      .map(([k, v]) => `<div><b>${k}</b> ${esc(v as string)}</div>`)
      .join('')}</div>`
  } else if (doc.email) {
    const e = doc.email
    header = `<div class="gh"><div class="subj">${esc(e.subject)}</div><div class="meta"><b>${esc(e.from.replace(/\s*<.*>/, ''))}</b> ${esc(/<.*>/.exec(e.from)?.[0] ?? '')}<br>to ${esc(e.to)}<br>${esc(e.sent)}</div></div>`
  }
  const lh = blocksHtml(doc.page?.letterhead ?? [], shot.ui)
  const body = blocksHtml(doc.blocks, shot.ui)
  const paper = shot.ui === 'paper'
  const sheet = shot.ui === 'excel'
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; background: ${paper ? '#fff' : bg}; color: ${fg}; font-family: ${shot.font}; font-size: ${size}px; line-height: 1.35; }
    .page { padding: ${paper ? '36px 44px' : shot.phone ? '10px 14px' : '14px 22px'}; ${paper ? 'max-width: 900px;' : ''} }
    .mh { padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1px solid ${dark ? '#444' : '#ddd'}; }
    .gh .subj { font-size: 1.45em; margin-bottom: 8px; }
    .gh .meta { color: ${dark ? '#bbb' : '#555'}; font-size: 0.9em; margin-bottom: 14px; }
    .gap { height: 0.9em; }
    .pair { display: flex; justify-content: space-between; gap: 24px; }
    .pair span:last-child { min-width: 38%; }
    table { border-collapse: collapse; margin: 8px 0 12px; }
    td, th { padding: ${sheet ? '1px 5px' : '3px 7px'}; vertical-align: top; word-wrap: break-word; }
    table.ruled td, table.ruled th { border: 1px solid ${sheet ? '#d4d4d4' : line}; }
    tr.h th { background: ${dark ? '#333' : sheet ? '#ddebf7' : '#eef1f5'}; font-weight: bold; }
    tr.alt td { background: ${dark ? '#2a2f36' : '#dce6f1'}; }
    tr.f td { font-weight: bold; }
  </style></head><body><div class="page">${header}${lh}${body}</div></body></html>`
}
