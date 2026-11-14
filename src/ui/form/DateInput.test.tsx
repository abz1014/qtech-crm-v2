import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { DateInput } from '@/ui/form/DateInput'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: ReturnType<typeof createRoot> | undefined
let el: HTMLElement
afterEach(() => {
  act(() => root?.unmount())
  el?.remove()
})

describe('DateInput width', () => {
  it('puts a width on the box round the field, so the calendar button stays inside the field', () => {
    el = document.createElement('div')
    document.body.appendChild(el)
    root = createRoot(el)
    act(() => root!.render(<DateInput aria-label="Paid on" value="2026-11-03" onChange={() => {}} defaultToday={false} wrapperClassName="w-[13.5rem]" />))
    const input = el.querySelector('input[type=text]')!
    const button = el.querySelector('button')!
    expect(input.parentElement!.className).toContain('w-[13.5rem]')
    expect(button.parentElement).toBe(input.parentElement)
    expect(input.className).not.toContain('w-[13.5rem]')
  })
})

describe('DateInput max', () => {
  const type = (input: HTMLInputElement, text: string) => {
    act(() => {
      input.focus()
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => input.blur())
  }

  it('marks a day after max invalid and reports it as empty; a day up to max is kept', () => {
    el = document.createElement('div')
    document.body.appendChild(el)
    root = createRoot(el)
    const seen: string[] = []
    function Held() {
      const [v, setV] = useState('2026-11-03')
      return <DateInput aria-label="Date" value={v} max="2026-11-10" onChange={x => (seen.push(x), setV(x))} defaultToday={false} />
    }
    act(() => root!.render(<Held />))
    const input = el.querySelector<HTMLInputElement>('input[type=text]')!
    expect(el.querySelector('input[type=date]')!.getAttribute('max')).toBe('2026-11-10')
    type(input, '11/12/2026')
    expect(seen.at(-1)).toBe('')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    type(input, '10/11/2026')
    expect(seen.at(-1)).toBe('2026-11-10')
    expect(input.getAttribute('aria-invalid')).not.toBe('true')
  })
})
