#!/usr/bin/env node
// Create the very first admin (A02). Runs on your own machine with the service-role key.
//
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/bootstrap-admin.mjs --name "Full Name" --email you@company.pk
//
// Refuses if any admin already exists. Prints the generated password once; it is never stored or logged.
// With --prompt-password you type your own password (hidden, asked twice) and it is never printed.
// --allow-weak (only with --prompt-password) accepts a weak password of 8+ characters with a warning.
// Against a non-local URL it also needs --allow-remote (see docs/SUPABASE.md, "First admin").
import './ws-shim.mjs'
import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { bootstrapAdmin, collectPassword, isLocalUrl, promptRefusal, readHidden } from './bootstrap-admin.lib.mjs'

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    email: { type: 'string' },
    'allow-remote': { type: 'boolean', default: false },
    'prompt-password': { type: 'boolean', default: false },
    'allow-weak': { type: 'boolean', default: false },
  },
})

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in this shell (not in a file in the repo).')
  process.exit(2)
}
if (!isLocalUrl(url) && !values['allow-remote']) {
  console.error(`Refusing: ${new URL(url).host} is not a local Supabase. Pass --allow-remote only for the real project, on purpose.`)
  process.exit(2)
}

if (values['allow-weak'] && !values['prompt-password']) {
  console.error('--allow-weak only works together with --prompt-password.')
  process.exit(2)
}
let chosen
if (values['prompt-password']) {
  const refusal = promptRefusal(process.stdin)
  if (refusal) {
    console.error(refusal)
    process.exit(2)
  }
  try {
    chosen = await collectPassword({
      ask: label => readHidden({ input: process.stdin, output: process.stdout, label }),
      say: line => console.log(line),
      allowWeak: values['allow-weak'],
    })
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

try {
  const result = await bootstrapAdmin({ client, name: values.name, email: values.email, ...(chosen ? { password: chosen } : {}) })
  console.log(`Created admin ${result.email} on ${new URL(url).host}`)
  if (chosen) console.log('Password set (not shown).')
  else console.log(`Password (shown once, copy it now): ${result.password}`)
  console.log('Sign in, then change nothing else: add everyone else from the Team screen.')
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
}
