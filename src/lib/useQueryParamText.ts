import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

/*
 * useQueryParamText (consistency spec 3.1): a list search kept in the address (`?q=`), so a reload or a shared link lands on the
 * same search. Typing replaces the history entry (Back leaves the list, it does not undo letters); clearing removes the param.
 * Every other param is kept.
 *   const [q, setQ] = useQueryParamText()            // ?q=
 *   const [q, setQ] = useQueryParamText('search')    // another key, when `q` is taken
 *   <TableFilter label="Search people" value={q} onChange={setQ} />
 * `also` lets one change reset other params in the same history entry (a pager going back to page 1: { page: null }).
 */
export function useQueryParamText(key = 'q'): [string, (next: string, also?: Record<string, string | null>) => void] {
  const [params, setParams] = useSearchParams()
  const urlValue = params.get(key) ?? ''
  // The box shows what was typed at once. React Router 7 applies the address change inside a transition, so a field that shows the
  // address value would lag and drop letters typed quickly ("nc" became "c"). The address follows the typing; an address change
  // that is not our own (Back, a link, a clear button elsewhere) replaces the typing.
  const [draft, setDraft] = useState(urlValue)
  const pushed = useRef<string[]>([])
  const urlRef = useRef(urlValue)
  urlRef.current = urlValue
  useEffect(() => {
    const at = pushed.current.indexOf(urlValue)
    if (at >= 0) {
      pushed.current.splice(0, at + 1)
      return
    }
    pushed.current = []
    setDraft(urlValue)
  }, [urlValue])
  const set = useCallback(
    (next: string, also?: Record<string, string | null>) => {
      setDraft(next)
      if (next !== urlRef.current || pushed.current.length > 0) pushed.current.push(next)
      setParams(
        prev => {
          const p = new URLSearchParams(prev)
          if (next === '') p.delete(key)
          else p.set(key, next)
          for (const [k, v] of Object.entries(also ?? {})) {
            if (v === null || v === '') p.delete(k)
            else p.set(k, v)
          }
          return p
        },
        { replace: true },
      )
    },
    [key, setParams],
  )
  return [draft, set]
}

/** Every word must match, case-insensitive (the board's rule, spec 3.1). `haystack` is the row's searchable text joined. */
export function matchesAllWords(haystack: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const h = haystack.toLowerCase()
  return words.every(w => h.includes(w))
}
