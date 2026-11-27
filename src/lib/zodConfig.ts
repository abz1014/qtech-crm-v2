// Zod 4 probes whether `new Function` works so it can compile faster parsers. Under the production CSP (no 'unsafe-eval') that probe is
// caught, but the browser still reports a securitypolicyviolation for it. jitless skips the probe and uses the plain parser.
// Imported first in main.tsx, before any schema is built.
//
// Zod keeps its settings on globalThis.__zod_globalConfig and adopts an object already there (zod/v4/core/core.js), so the setting is
// written without importing zod: zod itself then loads with the forms that use it, not in the start-up file every screen waits for
// (perf, about 33 KB raw). zodConfig.test.ts checks zod still reads it, so a zod upgrade that moves the setting fails there.
const g = globalThis as { __zod_globalConfig?: Record<string, unknown> }
g.__zod_globalConfig = Object.assign(g.__zod_globalConfig ?? {}, { jitless: true })
export {}
