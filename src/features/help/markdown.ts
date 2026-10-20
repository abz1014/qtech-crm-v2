/*
 * The help recipes' markdown (docs/help/*.md), parsed into plain data. No dependency and no HTML: the renderer
 * (Markdown.tsx) turns this into React elements, so nothing in a recipe can inject markup or script (the CSP allows none).
 *
 * Supported, and nothing else:
 *   # / ## / ### Heading          a heading
 *   1. Step                        numbered steps (a line indented under a step continues it)
 *   - Point                        a bullet
 *   Tip: ...  /  Safe to try: ...  a note line
 *   **bold**                       strong text
 *   [Label]                        an on-screen label, drawn as a chip (checked against the UI by labelSync.test.ts)
 *   anything else                  a paragraph; consecutive lines join with a space
 * A `[text](url)` link keeps its text and drops the address. `<b>` and other markup stay literal text.
 */

export type Inline = { kind: 'text'; text: string } | { kind: 'strong'; text: string } | { kind: 'label'; text: string }

export type NoteKind = 'tip' | 'safe'

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; inline: Inline[] }
  | { kind: 'para'; inline: Inline[] }
  | { kind: 'steps'; items: Inline[][] }
  | { kind: 'bullets'; items: Inline[][] }
  | { kind: 'note'; note: NoteKind; inline: Inline[] }

const NOTE_LEAD: Record<NoteKind, RegExp> = { tip: /^Tip:\s*/, safe: /^Safe to try:\s*/ }

/** Inline marks in one line of text: **bold** and [Label]. Unclosed marks stay as the characters typed. */
export function parseInline(line: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = () => {
    if (text) out.push({ kind: 'text', text })
    text = ''
  }
  let i = 0
  while (i < line.length) {
    const ch = line[i]
    if (ch === '\\' && i + 1 < line.length && '[]*\\'.includes(line[i + 1])) {
      text += line[i + 1]
      i += 2
      continue
    }
    if (ch === '*' && line[i + 1] === '*') {
      const end = line.indexOf('**', i + 2)
      if (end > i + 2) {
        flush()
        out.push({ kind: 'strong', text: line.slice(i + 2, end) })
        i = end + 2
        continue
      }
    }
    if (ch === '[') {
      const end = line.indexOf(']', i + 1)
      const inner = end > i + 1 ? line.slice(i + 1, end) : ''
      if (inner && !inner.includes('[')) {
        // [text](url): a link. Help never links out, so keep the words and drop the address.
        if (line[end + 1] === '(') {
          const close = line.indexOf(')', end + 2)
          if (close > end) {
            text += inner
            i = close + 1
            continue
          }
        }
        flush()
        out.push({ kind: 'label', text: inner.replace(/\s+/g, ' ').trim() })
        i = end + 1
        continue
      }
    }
    text += ch
    i++
  }
  flush()
  return out
}

/** The blocks of a markdown body (front matter already removed). */
export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  let list: { kind: 'steps' | 'bullets'; items: string[] } | null = null

  const endPara = () => {
    if (para.length) blocks.push({ kind: 'para', inline: parseInline(para.join(' ')) })
    para = []
  }
  const endList = () => {
    if (list) blocks.push({ kind: list.kind, items: list.items.map(parseInline) })
    list = null
  }

  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) {
      endPara()
      endList()
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    const step = /^\d+[.)]\s+(.*)$/.exec(line)
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    const note = (Object.keys(NOTE_LEAD) as NoteKind[]).find(k => NOTE_LEAD[k].test(line))
    if (heading) {
      endPara()
      endList()
      blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3, inline: parseInline(heading[2]) })
    } else if (step || bullet) {
      endPara()
      const kind = step ? 'steps' : 'bullets'
      if (list && list.kind !== kind) endList()
      list ??= { kind, items: [] }
      list.items.push((step ?? bullet)![1])
    } else if (note) {
      endPara()
      endList()
      blocks.push({ kind: 'note', note, inline: parseInline(line.replace(NOTE_LEAD[note], '')) })
    } else if (list && /^\s{2,}/.test(raw)) {
      // An indented line under a step or bullet continues it.
      list.items[list.items.length - 1] += ` ${line}`
    } else {
      endList()
      para.push(line)
    }
  }
  endPara()
  endList()
  return blocks
}

/** Every [Label] in a markdown body, in order, once each. */
export function labelsIn(src: string): string[] {
  const seen = new Set<string>()
  for (const block of parseMarkdown(src)) {
    const lines = block.kind === 'steps' || block.kind === 'bullets' ? block.items : [block.inline]
    for (const inline of lines) for (const part of inline) if (part.kind === 'label') seen.add(part.text)
  }
  return [...seen]
}

/** The plain words of some inline content (for search and word counts): labels keep their words, marks are dropped. */
export function plainText(inline: readonly Inline[]): string {
  return inline.map(p => p.text).join('')
}
