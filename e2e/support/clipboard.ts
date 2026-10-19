import { expect, type Page } from '@playwright/test'

/*
 * Read the clipboard after a Copy button was pressed.
 *
 * Copying is asynchronous (the page awaits navigator.clipboard.writeText, then shows its toast), so a read straight after the click can see
 * the old clipboard: empty, or the text of an earlier copy in the same test (run 39228025992 read ""). Never read it once.
 *
 *   resetClipboard(page)           call it BEFORE the click that copies: it puts a sentinel on the clipboard, so whatever is read afterwards
 *                                  can only be what this click wrote. A test that copies more than once must reset before each copy.
 *   readClipboardWhen(page, until) polls until the clipboard holds what the test is waiting for and returns that text. It never accepts the
 *                                  sentinel, even when `until` is a function that would say yes to anything.
 *
 *   until: a string the text must contain, a RegExp it must match, or a function that returns true for the text.
 */
export const CLIPBOARD_SENTINEL = '__cleared__'

export type ClipboardWait = string | RegExp | ((text: string) => boolean)

const matches = (until: ClipboardWait, text: string): boolean => (typeof until === 'string' ? text.includes(until) : until instanceof RegExp ? until.test(text) : until(text))

export async function resetClipboard(page: Page): Promise<void> {
  await page.evaluate(sentinel => navigator.clipboard.writeText(sentinel), CLIPBOARD_SENTINEL)
}

export async function readClipboardWhen(page: Page, until: ClipboardWait, timeout = 10_000): Promise<string> {
  let last = ''
  await expect
    .poll(
      async () => {
        last = await page.evaluate(() => navigator.clipboard.readText())
        return last !== CLIPBOARD_SENTINEL && matches(until, last)
      },
      { message: `the clipboard should hold ${typeof until === 'function' ? 'the expected text' : String(until)} (last read: ${JSON.stringify(last.slice(0, 80))})`, timeout },
    )
    .toBe(true)
  return last
}
