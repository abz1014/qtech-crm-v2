import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { keepCodes } from '@/ui/codes'

describe('keepCodes', () => {
  it('keeps each code on one line and leaves the words as they were', () => {
    const html = renderToStaticMarkup(<p>{keepCodes('Also deletes: 2 issued quotations (QT-26-0012 R0, R1), Copy of ORD-0002')}</p>)
    expect(html).toBe('<p>Also deletes: 2 issued quotations (<span class="whitespace-nowrap">QT-26-0012 R0</span>, R1), Copy of <span class="whitespace-nowrap">ORD-0002</span></p>')
  })
  it('passes plain words and nodes through', () => {
    expect(keepCodes('Rename category')).toBe('Rename category')
    const node = <b>x</b>
    expect(keepCodes(node)).toBe(node)
  })
})
