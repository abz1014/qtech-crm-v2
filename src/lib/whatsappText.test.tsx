import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { whatsappParts } from '@/lib/whatsappText'
import { WhatsAppText } from '@/ui/WhatsAppText'

describe('WhatsApp *bold* on screen (review 19)', () => {
  it('splits a message into plain and bold parts, the asterisks dropped', () => {
    expect(whatsappParts('Following up on our order *PI-123* of 3 Nov.')).toEqual([
      { text: 'Following up on our order ', bold: false },
      { text: 'PI-123', bold: true },
      { text: ' of 3 Nov.', bold: false },
    ])
  })
  it('leaves a lone asterisk, an empty pair and a pair across lines as typed', () => {
    expect(whatsappParts('5 * 3')).toEqual([{ text: '5 * 3', bold: false }])
    expect(whatsappParts('a ** b')).toEqual([{ text: 'a ** b', bold: false }])
    expect(whatsappParts('*one\ntwo*')).toEqual([{ text: '*one\ntwo*', bold: false }])
  })
  it('draws the bold words bold and no asterisks', () => {
    const { container } = render(
      <pre>
        <WhatsAppText text={'Dear Sir,\nInvoice *PI-123* is due on *1 Dec*.'} />
      </pre>,
    )
    expect(container.textContent).toBe('Dear Sir,\nInvoice PI-123 is due on 1 Dec.')
    expect([...container.querySelectorAll('b')].map(b => b.textContent)).toEqual(['PI-123', '1 Dec'])
  })
})
