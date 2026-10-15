import { createContext, useContext } from 'react'
import type { AddedFile } from '@/lib/fileIntake'
import type { CaptureSource } from '@/lib/capture/store'

/** What the person has captured so far. Lives in the provider so paste, drop, share and the buttons all add to the same thing. */
export interface Draft {
  id: string
  source: CaptureSource
  text: string
  files: AddedFile[]
}

/** The notice at the top of the sheet: the item came back after sign-in, or it was removed after 7 days. */
export type CaptureNotice = 'back' | 'expired' | null

export interface CaptureApi {
  open: boolean
  draft: Draft
  notice: CaptureNotice
  /** Files are being dragged over the window. */
  dragging: boolean
  /** Items kept on this device (waiting to be saved). */
  openCapture: () => void
  close: () => void
  setText: (text: string) => void
  /** Text and files from a paste, drop or picker: appended to the draft, and the sheet opens. */
  add: (input: { text?: string; files?: File[] }, source: CaptureSource) => void
  removeFile: (id: string) => void
  /** Forget the draft (after it is saved, or when the person starts over). */
  discard: () => void
  /** The Capture route: open the shared item (or the latest one kept) and say so. */
  openShared: (id: string | null) => void
}

export const CaptureContext = createContext<CaptureApi | null>(null)

export function useCapture(): CaptureApi {
  const api = useContext(CaptureContext)
  if (!api) throw new Error('useCapture needs a <CaptureProvider> (it is part of the app shell)')
  return api
}
