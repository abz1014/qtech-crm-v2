import { useEffect, useState, type CSSProperties, type RefObject } from 'react'

/**
 * A strip that scrolls sideways fades at the edge where it is cut, so a cut tab never reads as clipped (audit 2: the Money tabs at
 * 768 and 1024). Returns the mask style for the strip; nothing while it fits. `key` re-reads it (the lit tab changed).
 */
export function useScrollFade(ref: RefObject<HTMLElement | null>, key?: unknown): CSSProperties | undefined {
  const [cut, setCut] = useState<{ start: boolean; end: boolean }>({ start: false, end: false })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const start = el.scrollLeft > 1
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setCut(prev => (prev.start === start && prev.end === end ? prev : { start, end }))
    }
    read()
    el.addEventListener('scroll', read, { passive: true })
    window.addEventListener('resize', read)
    return () => {
      el.removeEventListener('scroll', read)
      window.removeEventListener('resize', read)
    }
  }, [ref, key])
  if (!cut.start && !cut.end) return undefined
  const fade = `linear-gradient(to right, ${cut.start ? 'transparent, #000 3rem' : '#000'}, ${cut.end ? '#000 calc(100% - 3rem), transparent' : '#000'})`
  return { maskImage: fade, WebkitMaskImage: fade }
}
