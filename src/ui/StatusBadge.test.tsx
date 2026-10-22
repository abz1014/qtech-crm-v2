import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { STATUS_ENTRIES } from '@/lib/status'
import { StatusBadge } from '@/ui/StatusBadge'
import { StatusText } from '@/ui/StatusText'

const html = (node: React.ReactElement) => renderToStaticMarkup(node)
const text = (node: React.ReactElement) =>
  html(node).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

describe('StatusBadge and the hidden keys (DESIGN_SYSTEM section 6, rule 2)', () => {
  const hidden = STATUS_ENTRIES.filter(([, , s]) => s.hidden)
  const visible = STATUS_ENTRIES.filter(([, , s]) => !s.hidden)

  it.each(hidden.map(([d, v]) => [`${d}:${v}`, d, v] as const))('(e) %s draws no chip', (_k, d, v) => {
    expect(html(<StatusBadge dimension={d} value={v} />)).toBe('')
  })

  it.each(visible.map(([d, v, s]) => [`${d}:${v}`, d, v, s.label] as const))('%s draws a chip with an icon and the word', (k, d, v, label) => {
    const out = html(<StatusBadge dimension={d} value={v} />)
    expect(out).toContain(`data-status="${k}"`)
    expect(out).toContain('<svg')
    expect(text(<StatusBadge dimension={d} value={v} />)).toBe(label)
  })
})

describe('StatusText', () => {
  it('draws a tone, a word and a second line, with no box', () => {
    const out = html(
      <StatusText tone="late" detail="12 days overdue">
        Send a reminder
      </StatusText>,
    )
    expect(out).toContain('data-tone="late"')
    expect(out).toContain('lucide-circle-alert')
    expect(out).toContain('text-tone-danger-fg')
    expect(out).toContain('text-sm')
    expect(out).not.toContain('bg-status-bg')
    expect(text(<StatusText tone="late" detail="12 days overdue">Send a reminder</StatusText>)).toBe('Send a reminder 12 days overdue')
  })

  it('picks the icon from the tone', () => {
    expect(html(<StatusText tone="now">Place the order</StatusText>)).toContain('lucide-circle-arrow-right')
    expect(html(<StatusText tone="waiting">On order</StatusText>)).toContain('lucide-clock')
    expect(html(<StatusText tone="done">Paid</StatusText>)).toContain('lucide-circle-check')
    expect(html(<StatusText tone="inert">Closed</StatusText>)).toContain('lucide-circle')
  })

  it('reads the registry, including a hidden key and an icon override', () => {
    expect(text(<StatusText dimension="goods" value="on_order" detail="Due 3 Nov" />)).toBe('Ordered Due 3 Nov')
    expect(html(<StatusText dimension="goods" value="on_order" />)).toContain('data-tone="waiting"')
    expect(text(<StatusText dimension="user" value="active" />)).toBe('Active')
    expect(html(<StatusText dimension="order" value="cancelled" />)).toContain('lucide-ban')
    expect(text(<StatusText dimension="payment" value="part" label="Awaiting payment">part paid</StatusText>)).toBe('Awaiting payment part paid')
  })

  it('throws for an unknown value while building', () => {
    expect(() => html(<StatusText dimension="goods" value="lost_in_transit" />)).toThrow()
  })
})
