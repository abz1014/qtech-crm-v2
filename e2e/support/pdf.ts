import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { API_URL, ANON_KEY, login, type Role } from './stack'

/*
 * PDF helpers for the e2e suites. The stored file is fetched from Storage as a fixture user (so the bucket's row level
 * security answers), and poppler (pdftotext, pdftoppm; on the GitHub ubuntu runner, installed by e2e.yml when missing)
 * reads it. When poppler is not installed (a developer machine), text and PNG rendering return null and the test that
 * needs them says so, instead of failing for a missing tool.
 */

export async function fetchStoredPdf(role: Role, bucket: string, path: string): Promise<Buffer | null> {
  const session = await login(role)
  const res = await fetch(`${API_URL}/storage/v1/object/${bucket}/${path}`, {
    headers: { apikey: ANON_KEY, authorization: `Bearer ${session.access_token}` },
  })
  if (!res.ok) return null
  return Buffer.from(await res.arrayBuffer())
}

function has(bin: string): boolean {
  try {
    execFileSync(bin, ['-v'], { stdio: 'ignore' })
    return true
  } catch (err) {
    // poppler prints its version to stderr and exits 0 for -v; a missing binary throws ENOENT.
    return (err as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}

export function pdfText(pdf: Buffer): string | null {
  if (!has('pdftotext')) return null
  const dir = mkdtempSync(join(tmpdir(), 'qt-pdf-'))
  try {
    const file = join(dir, 'in.pdf')
    writeFileSync(file, pdf)
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Renders page 1 of the PDF as a PNG into `outDir/name.png`. Returns the path, or null when poppler is missing. */
export function renderPdfPng(pdf: Buffer, outDir: string, name: string, dpi = 110): string | null {
  if (!has('pdftoppm')) return null
  mkdirSync(outDir, { recursive: true })
  const dir = mkdtempSync(join(tmpdir(), 'qt-pdf-'))
  try {
    const file = join(dir, 'in.pdf')
    writeFileSync(file, pdf)
    execFileSync('pdftoppm', ['-png', '-r', String(dpi), '-f', '1', '-l', '1', '-singlefile', file, join(outDir, name)])
    return join(outDir, `${name}.png`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export const pdfIsValid = (buf: Buffer | null): boolean => buf !== null && buf.length > 2000 && buf.subarray(0, 5).toString('latin1') === '%PDF-'

export function readFileBuf(path: string): Buffer {
  return readFileSync(path)
}
