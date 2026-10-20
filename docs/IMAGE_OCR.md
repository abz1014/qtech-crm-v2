# Reading RFQs from pictures (OCR)

Owner priority 2026-10-20. A screenshot or photo of an enquiry (Outlook email, WhatsApp chat, Excel range) is read **on the
device** by tesseract.js and handed to the same parser a paste goes through. Free, nothing uploaded, no outside service.

## The function

```ts
import { isImageFile, readImageText } from '@/lib/docread/imageText'

const r = await readImageText(file, {
  subject: 'items',              // or 'prices': only changes the wording of the messages
  signal: controller.signal,     // cancel: resolves { ok: false, reason: 'aborted', message: '' }
  onProgress: p => setNote(p.message), // "Reading the image… 40%", percent never goes back
})
if (r.ok) takePaste(r.text)      // same shape as readPdfText: text, lines, plus confidence and tableRows
else setNote(r.message)          // one sentence for the screen
```

Failure reasons and their messages (`imageFailureMessage`):

| reason | message (subject `items`) |
|---|---|
| `unclear` | Couldn't read this clearly — type or paste the items. |
| `unsupported` | This picture could not be opened on this device. Take a screenshot of it and use that, or type or paste the items. (HEIC outside Safari) |
| `too_big` | This picture is 30 MB; the limit is 25 MB. … |
| `not_image` | This file is not a picture. Paste the text, or type or paste the items. |
| `unreadable` | The picture reader could not start (it needs the internet the first time). Try again, or type or paste the items. |
| `aborted` | (empty) |

`isImageFile(file)` is true for `image/*` except SVG, and for a picture name (`.png .jpg .webp .heic …`) when the file has no type.

## How it reads

1. Scale to about 2000 px on the long edge (small crops up to 1400 px), grey, dark-mode flipped, contrast stretched, table rules
   wiped (`prepareImage`, `cleanPixels`, `removeRules`).
2. tesseract.js (LSTM, English best_int, page mode "single column") in a same-origin worker.
3. Letters smaller than 24 px: read again from a copy scaled so they are about 34 px (a laptop screenshot at 100% zoom).
4. Ink no word covers, on a row that was read (a lone "4" or "EA" in a bordered cell): each piece read again on its own
   (`ocrRecover.ts`).
5. Word boxes to lines and table rows with pdfLayout's row and column logic (cells joined by a tab), slant turned level, wrapped
   chat lines joined, phone and chat chrome dropped (`ocrLayout.ts`).

## What it costs (built, gzip)

Nothing on the first load and nothing in the service-worker precache (the bundle budget fails otherwise). On the first picture:

| File | Raw | Gzip |
|---|---|---|
| `assets/ocrRuntime-*.js` (lazy chunk, tesseract.js) | 62 KB | 18 KB |
| `assets/ocr/<versions>/worker.min.js` | 109 KB | 33 KB |
| `assets/ocr/<versions>/tesseract-core-simd-lstm.js` + `.wasm` (or the non-SIMD pair) | 87 KB + 2.79 MB | 24 KB + 1.04 MB |
| `assets/ocr/<versions>/eng.traineddata.gz` | 2.88 MB | (already gzip) |

About 4 MB over the wire the first time, then from the browser cache (`/assets/` is `immutable`; the directory is named after
the package versions). The files are written only into a build that contains the reader (vite.config.ts, `ocrAssets`).

## Adoption (not wired yet)

The screens are being changed by another task, so nothing calls it yet. The one change that wires every place a PDF is read
today: make the shared helper read pictures too, then let pictures through where PDFs are let through.

1. `src/features/rfqs/lib/readPdf.ts`: add, next to `readPdf`,

   ```ts
   import { isImageFile, readImageText, type ImageProgress } from '@/lib/docread/imageText'
   import { isPdfFile } from '@/lib/docread/pdfText'

   /** A PDF or a picture (screenshot, photo) of an enquiry or a quote, read on this device. */
   export async function readDocument(file: File, subject: PdfSubject, onProgress?: (p: ImageProgress) => void, signal?: AbortSignal) {
     if (!isPdfFile(file) && isImageFile(file)) {
       const r = await readImageText(file, { subject, onProgress, signal })
       return r.ok ? { text: r.text } : { message: r.message || "Couldn't read this clearly — type or paste the " + subject + '.' }
     }
     return readPdf(file, subject)
   }
   ```

2. `src/features/rfqs/IntakeScreen.tsx` (captured files, about line 275): where a PDF with no text is read,
   `captured.files.filter(f => isPdfFile(f))` becomes `captured.files.filter(f => isPdfFile(f) || isImageFile(f))`, and
   `await readPdf(f, 'items')` becomes `await readDocument(f, 'items', p => setPdfNote(p.message))`. Only when the capture has
   no text of its own (as today for PDFs).

3. `src/features/rfqs/PdfIntake.tsx`, `PdfPickButton`: `accept="application/pdf,.pdf"` becomes
   `accept="application/pdf,.pdf,image/*"`, and `await readPdf(file, subject)` becomes `await readDocument(file, subject, p => …)`
   (show `p.message` as the busy label: "Reading the image… 40%"). A label like "Choose PDF or screenshot".

4. `src/features/capture/CaptureSheet.tsx` (reply destination, about line 280): `find(f => isPdfFile(f))` becomes
   `find(f => isPdfFile(f) || isImageFile(f))`, and `src/features/rfqs/SupplierReplies.tsx` (about line 341)
   `readPdf(reply.pdf, 'prices')` becomes `readDocument(reply.pdf, 'prices')`. Do not read photos sent as a clarification
   answer or as attachments: they are pictures of parts, not text.

5. Keep a Cancel next to the progress (pass an `AbortController`'s signal); a second picture within a minute reuses the loaded
   reader.

## Tests

- `src/lib/docread/{imageText,ocrLayout,ocrRecover}.test.ts`: the pipeline with the engine replaced, layout from word boxes.
- `e2e/docread/ocr.spec.ts` (CI job "e2e", step "Picture reader (OCR) under the production CSP"): the real reader on
  `/dev/docread` (dev builds only) under the production Content-Security-Policy. Fictional screenshots (`e2e/docread/scenes.ts`,
  rendered in the test, no images committed) are read and their items scored through `parseEnquiry`; the accuracy table goes to
  the job summary. Gate: >= 90% item recall and precision on clean screenshots.
  `E2E_CSP=1 npx playwright test --project=docread` (`GALLERY_PORT=5287` when another checkout serves 5199).
