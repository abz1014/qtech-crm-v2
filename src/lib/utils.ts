import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/*
 * tailwind-merge only knows Tailwind's default scale. tailwind.config.ts adds token-named sizes (h-chip, h-control-sm,
 * size-icon-chip, text-table, font-regular, max-w-list ...), and without these lists merge treats them as unknown and
 * keeps BOTH the token class and an override such as `h-4`, or worse files `text-table` and `font-regular` under colour and
 * font family and drops a real class. Keep these in step with tailwind.config.ts: src/lib/utils.test.ts reads the config
 * and fails when a token size is missing here.
 */
export const TOKEN_SIZES = {
  h: ['control', 'control-sm', 'control-lg', 'segment', 'chip', 'row', 'row-tall', 'head', 'topbar', 'touch', 'indicator'],
  'min-h': ['control', 'control-sm', 'control-lg', 'segment', 'chip', 'row', 'row-tall', 'head', 'touch'],
  w: ['nav', 'touch', 'control', 'control-sm', 'control-lg'],
  'min-w': ['touch', 'chip'],
  'max-w': ['list', 'table', 'prose'],
  size: ['icon-chip', 'control-sm', 'touch'],
  text: ['stamp', 'table', 'display'],
  font: ['regular', 'heavy'],
  rounded: ['row', 'panel', 'round'],
} as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      h: [{ h: [...TOKEN_SIZES.h] }],
      'min-h': [{ 'min-h': [...TOKEN_SIZES['min-h']] }],
      w: [{ w: [...TOKEN_SIZES.w] }],
      'min-w': [{ 'min-w': [...TOKEN_SIZES['min-w']] }],
      'max-w': [{ 'max-w': [...TOKEN_SIZES['max-w']] }],
      size: [{ size: [...TOKEN_SIZES.size] }],
      'font-size': [{ text: [...TOKEN_SIZES.text] }],
      'font-weight': [{ font: [...TOKEN_SIZES.font] }],
      rounded: [{ rounded: [...TOKEN_SIZES.rounded] }],
      'rounded-t': [{ 'rounded-t': [...TOKEN_SIZES.rounded] }],
      'rounded-b': [{ 'rounded-b': [...TOKEN_SIZES.rounded] }],
      'rounded-l': [{ 'rounded-l': [...TOKEN_SIZES.rounded] }],
      'rounded-r': [{ 'rounded-r': [...TOKEN_SIZES.rounded] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
