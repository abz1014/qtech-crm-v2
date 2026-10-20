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

## Where it is used

Everything goes through `readDocument(file, subject, { onProgress, signal })` in `src/features/rfqs/lib/readPdf.ts`: a PDF
goes to `readPdfText`, a picture to `readImageText`; both give text for the same parser a paste goes through.

- New RFQ: "Choose PDF or photo" (`PdfPickButton`, accepts `application/pdf` and `image/*`: on a phone the camera and the
  gallery) shows "Reading the image… 40%" on the button, with a Cancel beside it. A screenshot pasted on the page (Win+Shift+S
  then Ctrl V) or with the phone's Paste button is read the same way. Paste or photo's "Start a new RFQ" with a picture and no
  text reads it too. Items fill the rows, the customer reference and due date fill when empty ("From the photo").
- A supplier's reply: "Read a PDF or photo", and Paste or photo's "This is a supplier's reply" with a picture and no text: the
  prices are read with `parseSupplierQuote`.
- Photos sent as a clarification answer or as attachments are not read: they are pictures of parts, not text.
- The paste zone on a touch screen shows a Paste button (the clipboard read where the browser allows it, else "Tap and hold in
  the box, then Paste"), never "Press Ctrl V".
- A scanned or unreadable PDF now points to the photo route ("Take a screenshot or photo of it and choose that instead").

## Tests

- `e2e/rfqs/intake.spec.ts`, "a screenshot on a phone (375)": a fictional Outlook RFQ screenshot chosen on New RFQ at 375 px
  with touch: 8 items, quantities, the customer reference; the Paste button and no Ctrl V.
- `src/lib/docread/{imageText,ocrLayout,ocrRecover}.test.ts`: the pipeline with the engine replaced, layout from word boxes.
- `e2e/docread/ocr.spec.ts` (CI job "e2e", step "Picture reader (OCR) under the production CSP"): the real reader on
  `/dev/docread` (dev builds only) under the production Content-Security-Policy. Fictional screenshots (`e2e/docread/scenes.ts`,
  rendered in the test, no images committed) are read and their items scored through `parseEnquiry`; the accuracy table goes to
  the job summary. Gate: >= 90% item recall and precision on clean screenshots.
  `E2E_CSP=1 npx playwright test --project=docread` (`GALLERY_PORT=5287` when another checkout serves 5199).
