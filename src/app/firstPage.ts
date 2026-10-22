/*
 * When the page the app opened on has its code and first data (perf/lcp). Set by src/app/routeChunks.ts when it fetches a page
 * ahead of the session; read by usePageSettled. Already settled when nothing was fetched ahead (and in tests).
 */
let firstPage: Promise<void> = Promise.resolve()

export function firstPageSettled(): Promise<void> {
  return firstPage
}

export function setFirstPage(settled: Promise<void>): void {
  firstPage = settled
}
