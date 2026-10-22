// HTTPS + HTTP/2 in front of the local Supabase stack, for the perf suite (scripts/ci/e2e-run.sh).
//
// Production talks to Supabase over HTTPS and HTTP/2; the local CI stack (Kong) speaks plain HTTP/1.1. Lighthouse's simulated
// Slow 4G models the two very differently (one multiplexed connection against six separate ones, each with its own handshake),
// so the perf suite's build talks to the stack through this proxy, which answers like production does. Nothing is changed in
// the requests or the answers. Local only: a throwaway self-signed certificate, 127.0.0.1.
//
// Usage: node scripts/ci/e2e-h2-proxy.mjs <listen port> <upstream origin> <key.pem> <cert.pem>
import http from 'node:http'
import http2 from 'node:http2'
import { readFileSync } from 'node:fs'

const [port, upstream, key, cert] = process.argv.slice(2)
if (!port || !upstream || !key || !cert) {
  console.error('usage: e2e-h2-proxy.mjs <port> <upstream origin> <key.pem> <cert.pem>')
  process.exit(2)
}
const target = new URL(upstream)
// HTTP/2 pseudo-headers and connection-specific headers cannot be forwarded to an HTTP/1.1 upstream.
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'http2-settings', 'te', 'host'])

const server = http2.createSecureServer({ key: readFileSync(key), cert: readFileSync(cert), allowHTTP1: true }, (req, res) => {
  const headers = {}
  for (const [name, value] of Object.entries(req.headers)) if (!name.startsWith(':') && !HOP.has(name)) headers[name] = value
  headers.host = target.host
  const out = http.request({ hostname: target.hostname, port: target.port, method: req.method, path: req.url, headers }, up => {
    const back = {}
    for (const [name, value] of Object.entries(up.headers)) if (!HOP.has(name)) back[name] = value
    res.writeHead(up.statusCode ?? 502, back)
    up.pipe(res)
  })
  out.on('error', err => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' })
    res.end(String(err))
  })
  req.pipe(out)
})
server.listen(Number(port), '127.0.0.1', () => console.log(`h2 proxy https://127.0.0.1:${port} -> ${target.origin}`))
