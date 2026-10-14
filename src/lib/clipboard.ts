/*
 * Copy text to the clipboard. The text may still be on its way (a Promise): the copy is started inside the tap, with the
 * promise handed to the browser, so a copy that has to wait for the network (the RFQ number arrives with the save) still
 * counts as part of the tap. Browsers that cannot take a promise get the text once it is ready.
 *
 * Returns true when the text is on the clipboard. A rejected text promise rejects here, so the caller can tell
 * "the save failed" from "the clipboard refused" (which resolves false).
 */
export async function copyToClipboard(text: string | Promise<string>): Promise<boolean> {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  if (nav?.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    const ready = Promise.resolve(text)
    // Suppress the unhandled rejection on the blob promise; the caller sees the same rejection through `ready` below.
    const blob = ready.then(t => new Blob([t], { type: 'text/plain' }))
    blob.catch(() => undefined)
    try {
      await nav.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
      return true
    } catch {
      await ready // a failed text promise throws here; a clipboard refusal falls through to the older ways
    }
  }
  const t = await text
  try {
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(t)
      return true
    }
  } catch {
    // fall through to the selection method
  }
  return legacyCopy(t)
}

function legacyCopy(t: string): boolean {
  if (typeof document === 'undefined') return false
  const area = document.createElement('textarea')
  area.value = t
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(area)
  }
}
