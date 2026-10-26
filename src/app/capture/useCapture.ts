import { createContext, useContext } from 'react'

/**
 * What the shell offers to open a capture: New enquiry. The Paste or photo sheet is gone (P4); a paste or a photo on a job is
 * added by "Add to this job", and the share target page offers New enquiry or Add to job.
 */
export interface CaptureApi {
  /** Opens New enquiry. */
  openCapture: () => void
}

export const CaptureContext = createContext<CaptureApi | null>(null)

export function useCapture(): CaptureApi {
  const api = useContext(CaptureContext)
  if (!api) throw new Error('useCapture needs a <CaptureProvider> (it is part of the app shell)')
  return api
}
