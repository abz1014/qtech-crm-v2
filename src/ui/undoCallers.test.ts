import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * Code review (p9): the Toast turns a rejected onUndo into a "Could not undo" alert (src/ui/Toast.tsx). An onUndo that catches its
 * own error and raises its own toast instead resolves, so the Undo toast still reads "Undone." beside the error: two toasts that
 * contradict each other. Every onUndo must let the error through.
 */
const root = path.resolve(__dirname, '..')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) return name === 'dev' ? [] : files(p)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : []
  })
}

/** The text of each `onUndo: async () => { ... }` body, by brace matching. */
function undoBodies(src: string): string[] {
  const out: string[] = []
  const re = /onUndo:\s*async\s*\(\)\s*=>\s*\{/g
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 1
    let i = m.index + m[0].length
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
    }
    out.push(src.slice(m.index, i))
  }
  return out
}

describe('Undo callers agree with the Toast (code review p9)', () => {
  it('no onUndo swallows its error with its own "Could not undo" toast (the Undo toast would still say "Undone.")', () => {
    const offenders = files(root).flatMap(f =>
      undoBodies(readFileSync(f, 'utf8'))
        .filter(body => /catch\s*\(/.test(body) && /Could not undo/.test(body))
        .map(() => path.relative(root, f).split(path.sep).join('/')),
    )
    expect(offenders).toEqual([])
  })
})
