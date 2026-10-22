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
5. Before the first read: the page lit evenly (shadows and paper tone flattened), a dark border from a photo's background
   removed, and a tilted photo turned level by its text lines (`flattenLight`, `clearBorderDark`, `estimateSkew`). Words read
   with low confidence are read again from an enlarged crop (`rereadDoubtful`).
6. Word boxes to lines and table rows with pdfLayout's row and column logic (cells joined by a tab), slant turned level, wrapped
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
- A scanned PDF (pages with no text, only a picture) is read page by page: each page drawn by pdf.js and read like a photo,
  with "Reading the scan… 40%" on the button and Cancel (`readPdfText`, lazy: nothing loads for a PDF that has text).

## Tests

- `e2e/rfqs/intake.spec.ts`, "a screenshot on a phone (375)": a fictional Outlook RFQ screenshot chosen on New RFQ at 375 px
  with touch: 8 items, quantities, the customer reference; the Paste button and no Ctrl V.
- `src/lib/docread/{imageText,ocrLayout,ocrRecover}.test.ts`: the pipeline with the engine replaced, layout from word boxes.
- `e2e/docread/ocr.spec.ts` (CI job "e2e", step "Picture reader (OCR) under the production CSP"): the real reader on
  `/dev/docread` (dev builds only) under the production Content-Security-Policy. Fictional screenshots (`e2e/docread/scenes.ts`,
  rendered in the test, no images committed) are read and their items scored through `parseEnquiry`; the accuracy table goes to
  the job summary. Gate: >= 90% item recall and precision on clean screenshots.
  `E2E_CSP=1 npx playwright test --project=docread` (`GALLERY_PORT=5287` when another checkout serves 5199).

## The reader corpus (accuracy gate)

`src/lib/docread/corpus/` generates fictional enquiries and supplier quotations (every name, part and number invented; no
customer data in the repository) from templates in 29 generations, as the text a person pastes, as PDFs (multi-page, wrapped,
turned, two-column headers, watermarks) and as pictures (screenshots at 100-150%, dark mode, phone chats, JPEG, blur, 3-8° tilt,
low contrast, shadows, scanned PDFs). `score.ts` scores every field per case (items, description, quantity, the customer's unit,
part number, reference, due date, company; price, currency, lead time, validity, payment, incoterm per quotation line) and
per shape.

- Batch 0 is split 70% dev / 30% held out; batches 1-30 are fresh batches, each made with new seeds and a new template
  generation written before the reader saw it, and checked once, first try. A fresh batch below 98% on any field or 95% on any
  shape became dev data and was fixed; batches 6, 29 and 30 passed first try and stay held out.
- `corpus.test.ts` (Vitest, in CI) reads text and PDF and fails on any value below `floor.text.json`.
- `e2e/docread/corpus.spec.ts` (CI job "e2e") renders the picture and scan cases in Chromium, reads them with the real OCR and
  fails below `floor.ocr.json` or when a clean screenshot's median read time passes 3 s. The OCR floors are measured on CI's
  Linux browser (fonts render differently from Windows or Mac); the run prints `OCR_VALUES {...}` to set them from.
- Re-measure locally: `CORPUS_BATCHES=0,1,... CORPUS_OUT=report.md npx vitest run src/lib/docread/corpus`;
  `CORPUS_WRITE_FLOOR=1` writes the floors after a change that improves them.
