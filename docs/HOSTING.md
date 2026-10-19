# Hosting: Vercel (primary), Cloudflare Pages (fallback)

The app is a static Vite build. It is hosted on Vercel (Hobby plan). The owner accepted the risk that Vercel's free tier has a non-commercial clause (see docs/DECISIONS.md, 2026-10-15). If Vercel ever suspends the project, switch to Cloudflare Pages (section below); its config stays in the repo.

## Deploy on Vercel

1. In Vercel, Add New, Project, import the GitHub repo `abz1014/qtech-crm-v2`.
2. Framework preset: **Vite**. Build command `npm run build`, output directory `dist` (the preset's defaults). Production branch `main`.
3. Environment variables (Production and Preview):

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://yafbphagorydbitfgfmg.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | the project's anon (public) key |

   Never put the service-role key in Vercel.
4. Deploy.
5. Paste the `https://<name>.vercel.app` address (or the custom domain) to the team; it is the production URL used below.

### Headers and routing (`vercel.json`)

- `vercel.json` holds the security headers (HSTS, CSP, Permissions-Policy, nosniff, X-Frame-Options, Referrer-Policy), long immutable caching for `/assets/*`, and an SPA rewrite that serves `/index.html` for every path that is not a file.
- The CSP allows only `'self'` plus the Supabase project `https://yafbphagorydbitfgfmg.supabase.co` for `connect-src` and `img-src` (P04). No `unsafe-eval`, no `data:` images, no `wss://` (the app does not use Realtime), no wildcard. Two things are kept on purpose: `'wasm-unsafe-eval'` in `script-src` (the PDF renderer's layout engine is WebAssembly; plain `eval` stays blocked) and `'unsafe-inline'` in `style-src` (React `style=` attributes for computed widths and grid columns, and Radix's scroll lock injecting a `<style>` element; script injection is still impossible, and a nonce would need a server that rewrites index.html). `blob:` is in `img-src` for the receipt thumbnail in the burst-entry sheet. If the Supabase project or a custom API domain changes, edit the CSP.
- The e2e workflow runs every suite under this exact policy: with `E2E_CSP=1` the preview server (`vite.config.ts`) sends the `/*` headers from `vercel.json` with the Supabase origin swapped for the local CI stack, and `e2e/perf` fails on any `securitypolicyviolation`.
- `public/_headers` carries the same headers for Cloudflare Pages. Keep both files in step: `scripts/hosting-headers.test.mjs` runs in CI (`npm test`) and fails if they drift.

### After the first deploy

1. Note the site origin (`https://<name>.vercel.app`, or the custom domain).
2. Run Actions, Deploy functions with `allowed_origins` set to that origin (docs/SUPABASE.md). `*.vercel.app` hostnames and custom domains pass validation; wildcards do not.
   Preview deployments (`<name>-<hash>-<team>.vercel.app`) are not allowed unless listed.
3. Add the origin to Supabase Auth, Site URL and redirect URLs, if auth redirects are used.
4. Check the headers on the live site (securityheaders.com) and that a deep link such as `/rfqs` loads after a hard refresh.

## Fallback: switch to Cloudflare Pages in 10 minutes

Cloudflare Pages is free with commercial use allowed. Use it if Vercel suspends the project.

| Setting | Value |
|---|---|
| Framework preset | Vite (or None) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Production branch | `main` |
| `NODE_VERSION` | `20` |
| `VITE_SUPABASE_URL` | `https://yafbphagorydbitfgfmg.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the project's anon (public) key |

- `public/_headers` is copied to `dist/_headers` by the build. SPA routing needs no rule: Pages serves `index.html` for unknown paths as long as the build has no `404.html`; there is none. Do not add one.
- Then repeat "After the first deploy" with the `https://<name>.pages.dev` origin: re-run Deploy functions with the new `allowed_origins` (the secret is replaced, not merged) and update Supabase Auth URLs.
