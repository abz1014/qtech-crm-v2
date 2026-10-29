import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getCapture, safely } from '@/lib/capture/store'

/*
 * A shared item handed to a job page ("Add to job…" on the share target). The address carries only the kept item's id
 * (/jobs/<key>?shared=<id>: the IndexedDB key, no personal data); the item itself is read from this device's Capture store each time the
 * page loads, so a reload brings it back. The id leaves the address only once the item is saved or discarded (clear()).
 */
export const SHARED_PARAM = 'shared'

export interface SharedIn {
  text?: string
  files?: File[]
  captureId?: string
}

export const SHARED_GONE = 'That shared item is no longer on this device (shared items are kept for 7 days). Share it again from WhatsApp.'

export type SharedState = { status: 'none' } | { status: 'loading' } | { status: 'gone' } | { status: 'ready'; shared: SharedIn }

export function useSharedItem(): { state: SharedState; id: string | null; clear: () => void } {
  const [params, setParams] = useSearchParams()
  const id = params.get(SHARED_PARAM)
  const [loaded, setLoaded] = useState<{ id: string; shared: SharedIn | null } | null>(null)
  useEffect(() => {
    if (!id) return
    let live = true
    void safely(() => getCapture(id), null).then(item => {
      if (!live) return
      setLoaded({
        id,
        shared: item ? { text: item.text, files: item.files.map(f => new File([f.blob], f.name, { type: f.type })), captureId: item.id } : null,
      })
    })
    return () => {
      live = false
    }
  }, [id])
  const clear = useCallback(() => {
    setParams(
      prev => {
        const next = new URLSearchParams(prev)
        next.delete(SHARED_PARAM)
        return next
      },
      { replace: true, state: null },
    )
  }, [setParams])
  const state: SharedState = !id ? { status: 'none' } : loaded?.id !== id ? { status: 'loading' } : loaded.shared ? { status: 'ready', shared: loaded.shared } : { status: 'gone' }
  return { state, id, clear }
}
