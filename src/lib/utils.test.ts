import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { cn, TOKEN_SIZES } from '@/lib/utils'
import { controlClass } from '@/ui/form/fieldContext'

/* cn() must merge the token-named classes from tailwind.config.ts like Tailwind's own, so an override replaces them. */
const config = readFileSync(path.resolve(__dirname, '../../tailwind.config.ts'), 'utf8')

/** The keys of one `name: { ... }` block in the Tailwind config (the extend block for sizes, the theme for fontSize). */
function keys(block: string): string[] {
  const m = new RegExp(`\\b${block}:\\s*\\{`).exec(config)
  if (!m) throw new Error(`no ${block} block in tailwind.config.ts`)
  // Up to the matching brace, then only the top-level keys of that object.
  let depth = 0
  let body = ''
  for (const ch of config.slice(m.index + m[0].length - 1)) {
    if (ch === '{' || ch === '[' || ch === '(') depth++
    else if (ch === '}' || ch === ']' || ch === ')') depth--
    else if (depth === 1) body += ch
    if (depth === 0) break
  }
  return [...body.matchAll(/(?:^|[,\s])(?:'([\w-]+)'|([A-Za-z0-9][\w-]*)):/g)].map(k => k[1] ?? k[2])
}

describe('cn knows every token size in tailwind.config.ts', () => {
  for (const [block, group] of [['height', 'h'], ['minHeight', 'min-h'], ['width', 'w'], ['minWidth', 'min-w'], ['size', 'size']] as const) {
    it(`${block} (${group}-*)`, () => {
      const listed: readonly string[] = TOKEN_SIZES[group]
      expect(keys(block).filter(k => !listed.includes(k))).toEqual([])
    })
  }

  it('the custom type sizes and the regular weight', () => {
    expect(keys('fontSize').filter(k => !['xs', 'sm', 'base', 'lg', 'xl', '2xl', ...TOKEN_SIZES.text].includes(k))).toEqual([])
    expect(keys('fontWeight').filter(k => !['medium', 'semibold', ...TOKEN_SIZES.font].includes(k))).toEqual([])
  })
})

describe('an override replaces the token class instead of sitting beside it', () => {
  it.each([
    ['h-chip min-w-chip', 'h-4 min-w-4', 'h-4 min-w-4'],
    ['h-control px-3', 'h-[28px]', 'px-3 h-[28px]'],
    ['h-control-sm w-control-sm', 'h-control w-control', 'h-control w-control'],
    ['size-icon-chip', 'size-4', 'size-4'],
    ['min-h-chip', 'min-h-0', 'min-h-0'],
  ])('%s + %s', (base, override, out) => {
    expect(cn(base, override)).toBe(out)
  })

  it('text-table is a size, not a colour: a colour beside it no longer removes it', () => {
    expect(cn('w-full text-table', 'text-fg')).toBe('w-full text-table text-fg')
    expect(cn('text-table', 'text-xs')).toBe('text-xs')
  })

  it('the 28 px toolbar fields (GST register search, report date, order GST select) really are 28 px', () => {
    const out = cn(controlClass, 'h-[28px] pl-8 text-xs').split(' ')
    expect(out).toContain('h-[28px]')
    expect(out).not.toContain('h-control')
    expect(out).toContain('text-xs')
    expect(out).toContain('max-md:text-[16px]') // still 16 px on a phone, so iOS does not zoom
  })

  it('font-regular is a weight, not a family: font-sans beside it is kept (the PKR prefix in Money)', () => {
    expect(cn('mr-1 font-sans font-regular text-fg-muted')).toBe('mr-1 font-sans font-regular text-fg-muted')
    expect(cn('font-medium', 'font-regular')).toBe('font-regular')
  })
})
