import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { labelsIn, parseInline, parseMarkdown } from '@/features/help/markdown'
import { InlineMarkdown, MarkdownBlocks } from '@/features/help/RecipeText'
import { axeViolations } from '@/test/axe'

describe('help markdown parser (no dependency, no HTML)', () => {
  it('reads steps, bullets, headings, paragraphs and the Tip / Safe to try notes', () => {
    const blocks = parseMarkdown(
      ['## Before you start', 'One line', 'joined to this.', '', '1. Tap [RFQs].', '2. Tap [New RFQ]', '   and paste.', '', '- a point', '', 'Tip: Use [Search].', 'Safe to try: [Undo] puts it back.'].join('\n'),
    )
    expect(blocks.map(b => b.kind)).toEqual(['heading', 'para', 'steps', 'bullets', 'note', 'note'])
    expect(blocks[1]).toEqual({ kind: 'para', inline: [{ kind: 'text', text: 'One line joined to this.' }] })
    const steps = blocks[2]
    expect(steps.kind === 'steps' && steps.items.length).toBe(2)
    expect(steps.kind === 'steps' && steps.items[1]).toEqual([
      { kind: 'text', text: 'Tap ' },
      { kind: 'label', text: 'New RFQ' },
      { kind: 'text', text: ' and paste.' },
    ])
    expect(blocks[4]).toMatchObject({ kind: 'note', note: 'tip' })
    expect(blocks[5]).toMatchObject({ kind: 'note', note: 'safe' })
  })

  it('marks **bold** and [Label]; a [text](url) link keeps only its words; unclosed marks stay as typed', () => {
    expect(parseInline('**Got it** then [Mark won]')).toEqual([
      { kind: 'strong', text: 'Got it' },
      { kind: 'text', text: ' then ' },
      { kind: 'label', text: 'Mark won' },
    ])
    expect(parseInline('see [the guide](https://example.com) now')).toEqual([{ kind: 'text', text: 'see the guide now' }])
    expect(parseInline('a [ and ** b')).toEqual([{ kind: 'text', text: 'a [ and ** b' }])
    expect(parseInline('\\[not a label\\]')).toEqual([{ kind: 'text', text: '[not a label]' }])
  })

  it('lists every label once, in order', () => {
    expect(labelsIn('1. [A] and [B]\n2. [A] again\n\nTip: [C]')).toEqual(['A', 'B', 'C'])
  })

  it('renders markup in a recipe as text, never as HTML', () => {
    const { container } = render(<MarkdownBlocks blocks={parseMarkdown('1. <img src=x onerror=alert(1)> <b>bold</b> [<script>]')} />)
    expect(container.querySelector('img, b, script')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(screen.getByText('<script>')).toHaveAttribute('data-label')
  })

  it('draws steps as an ordered list with labels as chips, and is axe-clean', async () => {
    const { container } = render(
      <div>
        <MarkdownBlocks blocks={parseMarkdown('1. Tap [Today].\n2. Tap **Snooze**.\n\nTip: one line.')} />
        <p>
          <InlineMarkdown text="**New RFQ**, then paste." />
        </p>
      </div>,
    )
    const items = container.querySelectorAll('ol > li')
    expect(items).toHaveLength(2)
    expect(screen.getByText('Today')).toHaveAttribute('data-label')
    expect(screen.getByText('Tip:').tagName).toBe('STRONG')
    expect(await axeViolations(container)).toEqual([])
  })
})
