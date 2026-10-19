import { createCapture, purgeExpired } from './store'

/*
 * The Web Share Target POST (R22). WhatsApp's "Share, Q-Tech CRM" sends multipart/form-data to /capture with the fields the
 * manifest names (title, text, url, files). The service worker turns it into a stored item and redirects to the page with
 * a GET (303), so the browser never re-posts and a refresh is safe. The item is saved BEFORE the app checks the session,
 * so a sign-in redirect cannot lose it. The files are stored as they arrived; the sheet shrinks photos when it opens.
 */
export const SHARE_PATH = '/capture'

/*
 * Security review L-4. Any page on the internet can POST a form to /capture, exactly as a share does (a check on
 * Sec-Fetch-Site was not added: it cannot be tested against Android's share sheet in CI, and a wrong guess would break
 * WhatsApp share). What arrives is only ever a DRAFT on this device: nothing reaches the database until the signed-in
 * person picks a destination and taps Save. The caps below keep a hostile post from filling the device.
 */
export const MAX_SHARE_FILES = 10
export const MAX_SHARE_BYTES = 25 * 1024 * 1024
export const MAX_SHARE_TEXT = 20_000

/** The first files that fit the caps, in the order they came. */
export function capFiles<T extends { size: number }>(files: readonly T[]): T[] {
  const out: T[] = []
  let total = 0
  for (const f of files) {
    if (out.length >= MAX_SHARE_FILES || total + f.size > MAX_SHARE_BYTES) continue
    out.push(f)
    total += f.size
  }
  return out
}

export function isShareRequest(request: { method: string }, url: URL, ownOrigin: string): boolean {
  return request.method === 'POST' && url.origin === ownOrigin && url.pathname === SHARE_PATH
}

export function sharedText(form: FormData): string {
  const part = (k: string) => {
    const v = form.get(k)
    // A form post turns line breaks into CRLF; keep plain LF, as typed and pasted text has it.
    return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : ''
  }
  const title = part('title')
  const text = part('text')
  const link = part('url')
  // Android often repeats the link inside the text; keep each piece once.
  return [title && title !== text ? title : '', text, link && !text.includes(link) ? link : ''].filter(Boolean).join('\n')
}

export async function handleShareRequest(request: Request, ownOrigin: string, now = Date.now()): Promise<Response> {
  let id = ''
  try {
    const form = await request.formData()
    const files = capFiles(
      form
        .getAll('files')
        .filter((f): f is File => typeof f !== 'string' && f.size > 0)
        .map(f => ({ name: f.name || 'shared-file', type: f.type, size: f.size, blob: f as Blob })),
    )
    const text = sharedText(form).slice(0, MAX_SHARE_TEXT)
    if (text || files.length) {
      const item = await createCapture({ source: 'share', text, files }, now)
      id = item.id
    }
    void purgeExpired(now).catch(() => 0)
  } catch {
    // An unreadable share still opens Capture, empty: the person can paste it instead.
  }
  return Response.redirect(`${ownOrigin}${SHARE_PATH}${id ? `?share=${id}` : ''}`, 303)
}
