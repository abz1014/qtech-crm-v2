import { expect, type Page } from '@playwright/test'

/*
 * Read the clipboard after a Copy button was pressed.
 *
 * Copying is asynchronous (the page awaits navigator.clipboard.writeText, then shows its toast), so a read straight after the click can see
 * the old clipboard: empty, or the text of an earlier copy in the same test (run 39228025992 read ""). Never read it once. This polls until
 * the clipboard holds what the test is waiting for and returns that text for further assertions.
 *
 *   until: a string the text must contain, a RegExp it must match, or a function that returns true for the text.
 */
export type ClipboardWait = string | RegExp | ((text: string) => boolean)

const matches = (until: ClipboardWait, text: string): boolean => (typeof until === 'string' ? text.includes(until) : until instanceof RegExp ? until.test(text) : until(text))

export async function readClipboardWhen(page: Page, until: ClipboardWait, timeout = 10_000): Promise<string> {
  let last = ''
  await expect
    .poll(
      async () => {
        last = await page.evaluate(() => navigator.clipboard.readText())
        return matches(until, last)
      },
      { message: `the clipboard should hold ${typeof until === 'function' ? 'the expected text' : String(until)} (last read: ${JSON.stringify(last.slice(0, 80))})`, timeout },
    )
    .toBe(true)
  return last
}
