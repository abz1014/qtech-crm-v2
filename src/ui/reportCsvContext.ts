import { createContext } from 'react'

/**
 * The report frame's Export CSV. `csv` is undefined where the report has no CSV, null while the figures load and a function once
 * they are in. `claim` tells the frame that a report body draws the button itself (under its summary), so the frame does not.
 */
export interface ReportCsvValue {
  csv: (() => void) | null | undefined
  claim: (on: boolean) => void
}
export const ReportCsvContext = createContext<ReportCsvValue | null>(null)
