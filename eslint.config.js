import js from '@eslint/js'
import globals from 'globals'
import importPlugin from 'eslint-plugin-import'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

// Arbitrary Tailwind values that bypass the tokens. Matched inside any string
// or template literal, so className="...", cn(...) and cva(...) are all caught.
const colourProps = 'bg|text|border|ring|ring-offset|fill|stroke|from|via|to|outline|divide|decoration|accent|caret|placeholder|shadow'
const colourAndShadowBans = [
  {
    // bg-[#fff], text-[rgb(...)], border-[hsl(...)], bg-[oklch(...)], bg-[color:...]
    re: String.raw`(^|[\s:!])-?(${colourProps})-\[(#|rgba?\(|hsla?\(|oklch\(|color:)`,
    message: 'Arbitrary colours are banned. Use a token class (bg-surface, text-fg-muted, border-line, ...). See docs/DESIGN_SYSTEM.md section 5.',
  },
  {
    re: String.raw`(^|[\s:!])shadow-\[`,
    message: 'Arbitrary shadows are banned. Use shadow-pop or shadow-modal (overlays only). See docs/DESIGN_SYSTEM.md section 4.',
  },
]
const textSizeBans = [
  {
    re: String.raw`(^|[\s:!])text-\[`,
    message: 'text-[...] is banned. Use the type scale: text-xs, text-sm, text-base, text-lg, text-xl, text-2xl, text-display, text-table.',
  },
]
function classBans(list) {
  return list.flatMap(({ re, message }) => [
    { selector: `Literal[value=/${re}/]`, message },
    { selector: `TemplateElement[value.raw=/${re}/]`, message },
  ])
}

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'import/.data', 'backups', 'supabase/functions'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx,js}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      import: importPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Packages must be declared in THIS package.json (Node resolves upward into
      // parent folders' node_modules, which would hide phantom dependencies).
      'import/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: [
            '**/*.test.{ts,tsx}',
            'e2e/**/*.{ts,tsx}',
            '**/*.config.{ts,js}',
            'src/test/**',
          ],
          includeInternal: false,
        },
      ],
    },
  },
  // Design-system lint bans (U01). Tokens are the only source of colour, shadow
  // and text size (docs/DESIGN_SYSTEM.md). Tests and the dev gallery are exempt
  // so that the bans themselves can be tested with planted violations.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...classBans(colourAndShadowBans)],
    },
  },
  {
    files: ['src/features/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...classBans(colourAndShadowBans),
        ...classBans(textSizeBans),
        {
          selector: "JSXOpeningElement[name.name=/^(table|thead|tbody|tfoot|tr|th|td)$/]",
          message: 'Raw table markup is banned outside primitives. Use <DataTable> (docs/design/INVENTORY.md).',
        },
      ],
    },
  },
  // R01: server state lives in TanStack Query, never in React context. Features may not create a context at all;
  // a UI-only context (a wizard's step, a panel's open state) takes an eslint-disable that says why. The app shell
  // (src/app) keeps its session and palette contexts: those are not server data.
  {
    files: ['src/features/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              importNames: ['createContext'],
              message:
                'No React context for data in features (R01). Read server data with the TanStack Query hooks in src/features/<area>/hooks.ts so every screen shares one cache. See src/features/README.md.',
            },
          ],
        },
      ],
    },
  },
)
