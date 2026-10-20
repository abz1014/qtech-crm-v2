// tesseract.js ships an ES module build of its browser bundle (dist/tesseract.esm.min.js) without types of its own; it is the
// same API as the package's main entry, whose types are reused here.
declare module 'tesseract.js/dist/tesseract.esm.min.js' {
  import type * as TesseractTypes from 'tesseract.js'
  const Tesseract: typeof TesseractTypes
  export default Tesseract
}
