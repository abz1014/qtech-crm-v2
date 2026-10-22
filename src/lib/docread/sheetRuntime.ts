// SheetJS (xlsx, Apache-2.0, from the SheetJS CDN: the npm registry's copy is years behind), loaded only when a spreadsheet is
// read: sheetText.ts imports this module dynamically, so it is its own lazy chunk, never part of the first load and never
// precached by the service worker (vite.config.ts). Everything runs on the device; nothing is uploaded.
export { read, SSF, utils } from 'xlsx'
