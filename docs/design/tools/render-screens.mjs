// Renders reference PNGs from the committed mockups (D09).
// Usage (from the repo root, with playwright-core and sharp installed somewhere resolvable):
//   node docs/design/tools/render-screens.mjs
// Serves the repo root statically, opens each docs/design/mockups/g2-*.html at 1440 px,
// and screenshots every board (.board-wrap) or document sheet at its native width.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(process.env.RENDER_DEPS ?? import.meta.url);
const { chromium } = require('playwright-core');
const sharp = require('sharp');

const root = process.cwd();
const outDir = path.join(root, 'docs/design/screens');
const mime = { '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': mime[path.extname(p)] ?? 'application/octet-stream' }); res.end(d);
  });
}).listen(0);
const port = server.address().port;

const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const files = fs.readdirSync(path.join(root, 'docs/design/mockups')).filter((f) => /^g2-.*\.html$/.test(f));
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
let total = 0;
fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
for (const f of files) {
  const name = f.replace(/^g2-|\.html$/g, '');
  await page.goto(`http://localhost:${port}/docs/design/mockups/${f}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
  const save = async (buf, n, cap) => {
    const file = path.join(outDir, `${name}-${String(n).padStart(2, '0')}-${slug(cap) || 'board'}.png`);
    await sharp(buf).png({ palette: true, quality: 85, compressionLevel: 9, effort: 8 }).toFile(file);
    total++;
  };
  let n = 0;
  if (await page.$('.sec-head')) {
    // Pages organised in sections: one PNG per section (heading down to the next heading).
    const secs = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('.sec-head')];
      return heads.map((h, i) => {
        const top = h.getBoundingClientRect().top + scrollY;
        let bottom;
        const next = heads[i + 1];
        if (next) bottom = next.getBoundingClientRect().top + scrollY - 24;
        else { const last = h.parentElement.lastElementChild; bottom = last.getBoundingClientRect().bottom + scrollY; }
        const r = h.parentElement.getBoundingClientRect();
        return { cap: h.querySelector('h2')?.textContent ?? h.id, top, bottom, x: r.left + scrollX, w: r.width };
      });
    });
    for (const s of secs) {
      n++;
      const buf = await page.screenshot({ type: 'png', fullPage: true, clip: { x: Math.max(0, s.x), y: s.top, width: Math.min(1440, s.w), height: s.bottom - s.top } });
      await save(buf, n, s.cap);
    }
  } else {
    let sel = '.board-wrap';
    if (!(await page.$(sel))) sel = '.sheet-in';
    for (const el of await page.$$(sel)) {
      const box = await el.boundingBox();
      if (!box || box.height < 40) continue;
      n++;
      const cap = await el.evaluate((e) => (e.querySelector('h2,.sheet-cap')?.textContent ?? '').trim());
      await save(await el.screenshot({ type: 'png' }), n, cap);
    }
  }
  console.log(f, n);
}
console.log('total', total);
await browser.close(); server.close();
