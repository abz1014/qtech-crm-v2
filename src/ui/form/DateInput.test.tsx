import { act } from 'react'
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
