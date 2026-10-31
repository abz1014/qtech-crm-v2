import { z } from 'zod'

// Zod 4 probes whether `new Function` works so it can compile faster parsers. Under the production CSP (no 'unsafe-eval') that probe is
// caught, but the browser still reports a securitypolicyviolation for it. jitless skips the probe and uses the plain parser.
// Imported first in main.tsx, before any schema is built.
z.config({ jitless: true })
