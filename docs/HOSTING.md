# Hosting: Cloudflare Pages

The app is a static Vite build. It is hosted on Cloudflare Pages (free, commercial use allowed). Vercel was dropped because its free tier is non-commercial.

## Pages project settings

| Setting | Value |
|---|---|
| Framework preset | Vite (or None) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Production branch | `main` |
| `NODE_VERSION` | `20` |
| `VITE_SUPABASE_URL` | `https://yafbphagorydbitfgfmg.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the project's anon (public) key |

Set the variables for both Production and Preview. Never put the service-role key in Pages.

## Headers and routing

- `public/_headers` is copied to `dist/_headers` by the build and holds the security headers (HSTS, CSP, Permissions-Policy, nosniff, X-Frame-Options, Referrer-Policy).
  The CSP allows only `'self'` plus the Supabase project `https://yafbphagorydbitfgfmg.supabase.co` (and `wss://` on the same host, for realtime if used).
  If the Supabase project or a custom API domain changes, edit the CSP there.
- SPA routing needs no rule. Pages serves `index.html` for unknown paths as long as the build has no `404.html`; there is none. Do not add one.
- `vercel.json` has been removed.

## After the first deploy

1. Note the site origin (`https://<name>.pages.dev`, or the custom domain).
2. Run Actions, Deploy functions with `allowed_origins` set to that origin (docs/SUPABASE.md). `*.pages.dev` hostnames and custom domains both pass validation; wildcards do not.
   Preview deployments (`<hash>.<name>.pages.dev`) are not allowed unless listed.
3. Add the origin to Supabase Auth, Site URL and redirect URLs, if auth redirects are used.
4. Check the headers on the live site (securityheaders.com) and that a deep link such as `/rfqs` loads after a hard refresh.
