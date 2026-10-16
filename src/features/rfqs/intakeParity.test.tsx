import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { optionMeta, parseQtyCell } from '@/features/rfqs/lib/intakeModel'
import { EnquiryCard } from '@/features/rfqs/IntakeParts'

describe('Qty cell', () => {
  it('reads "2 nos", "150 m" and a bare number', () => {
    expect(parseQtyCell('2 nos')).toEqual({ qty: 2, unit: 'nos' })
    expect(parseQtyCell('150 m')).toEqual({ qty: 150, unit: 'm' })
    expect(parseQtyCell('1,200')).toEqual({ qty: 1200, unit: '' })
    expect(parseQtyCell('')).toEqual({ qty: null, unit: '' })
  })
})

describe('company option meta', () => {
  const hit = { id: 'c', name: 'Mianwali Plastics Ltd', country: 'Pakistan', city: 'Mianwali', role: 'customer' as const, rfqCount: 2, similar: true }
  it('is city, role, RFQ count and the similar-name flag', () => {
    expect(optionMeta(hit)).toBe('Mianwali · customer · 2 RFQs · similar name')
  })
  it('falls back to the country, and leaves out what is not known', () => {
    expect(optionMeta({ ...hit, city: null, rfqCount: 1, similar: false })).toBe('Pakistan · customer · 1 RFQ')
    expect(optionMeta({ ...hit, city: null, country: null, role: null, rfqCount: 0, similar: false })).toBe('')
  })
})

describe('enquiry text as drawn', () => {
  it('shows a blank Spec as a highlighted blank and the ref in bold', () => {
    const { container } = render(
      <EnquiryCard
        count={1}
        variant="whatsapp"
        onVariant={() => {}}
        recipients={[{ id: 's', name: 'Orient' }]}
        onRemoveRecipient={() => {}}
        subject={null}
        body={'Please quote (our ref *RFQ-0185*):\n1. Flow meter, 2 nos\n   Spec: left blank'}
        onBody={() => {}}
        actions={null}
        note="You paste it into each supplier’s chat."
        locked={false}
      />,
    )
    expect(container.querySelectorAll('[data-spec-blank]')).toHaveLength(1)
    expect(screen.getByText('RFQ-0185').tagName).toBe('B')
    expect(screen.getByRole('button', { name: 'Edit the text' })).toBeInTheDocument()
  })
})
