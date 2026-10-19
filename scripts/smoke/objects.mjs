// S16: the list of public tables, views and RPCs, read from the generated types (src/types/database.ts) so the
// smoke suite stays complete without a hand-kept list. Uses the TypeScript compiler API; no database needed.
import fs from 'node:fs'
import ts from 'typescript'

function propName(m) {
  const n = m.name
  if (!n) return null
  return ts.isStringLiteral(n) || ts.isIdentifier(n) ? n.text : null
}

function members(typeNode) {
  return typeNode && ts.isTypeLiteralNode(typeNode) ? typeNode.members : []
}

function find(typeNode, name) {
  for (const m of members(typeNode)) if (ts.isPropertySignature(m) && propName(m) === name) return m.type
  return undefined
}

// Returns { tables: string[], views: string[], functions: { name, args: string[] }[] } for the `public` schema.
export function listPublicObjects(typesPath) {
  const src = fs.readFileSync(typesPath, 'utf8')
  const sf = ts.createSourceFile(typesPath, src, ts.ScriptTarget.Latest, true)
  let dbType
  sf.forEachChild((n) => {
    if (ts.isTypeAliasDeclaration(n) && n.name.text === 'Database') dbType = n.type
  })
  const pub = find(dbType, 'public')
  if (!pub) throw new Error(`no "public" schema found in ${typesPath}`)
  const names = (sectionName) =>
    members(find(pub, sectionName))
      .filter((m) => ts.isPropertySignature(m) && propName(m))
      .map((m) => m)
  const tables = names('Tables').map(propName).sort()
  const views = names('Views').map(propName).sort()
  const functions = names('Functions')
    .map((m) => {
      const args = []
      for (const a of members(find(m.type, 'Args'))) {
        const k = ts.isPropertySignature(a) ? propName(a) : null
        if (k) args.push(k)
      }
      return { name: propName(m), args }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  return { tables, views, functions }
}
