import path from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../..')

async function lint(filePath: string, code: string) {
  const eslint = new ESLint({ cwd: root })
  const [result] = await eslint.lintText(code, { filePath: path.join(root, filePath) })
  return result.messages.filter(m => m.ruleId === 'no-restricted-imports').map(m => m.message)
}

describe('R01: no React context for server state in features', () => {
  it('rejects createContext in a feature', async () => {
    const m = await lint('src/features/x/Ctx.tsx', "import { createContext } from 'react'\nexport const C = createContext(null)")
    expect(m.join()).toContain('No React context for data in features')
  })

  it('allows the other react imports in a feature', async () => {
    const m = await lint('src/features/x/Y.tsx', "import { useState, useContext } from 'react'\nexport const Y = () => useState(useContext)")
    expect(m).toEqual([])
  })

  it('leaves the app shell its session and palette contexts', async () => {
    const m = await lint('src/app/x.ts', "import { createContext } from 'react'\nexport const C = createContext(null)")
    expect(m).toEqual([])
  })
})
