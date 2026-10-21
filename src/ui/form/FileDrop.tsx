import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Plus, Upload } from 'lucide-react'
import { acceptLabel, DEFAULT_ACCEPT, DEFAULT_MAX_BYTES, formatBytes, intakeFiles, type AddedFile } from '@/lib/fileIntake'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { Kbd } from '@/ui/Kbd'

/*
 * FileDrop (INVENTORY: U07; D08 section 01). A drop zone with three ways in:
 * drop, paste (Cmd/Ctrl+V anywhere on the page, except while typing in a field),
 * and the "Choose files" button. Images are shrunk before they are reported
 * (src/lib/imageCompress); files over the limit or of another type come back
 * with an `error` so a FileRow can say why, nothing is dropped silently.
 * States: resting, drag over (brand-green dashed edge, "Release to add 2 files").
 * `onAdd` receives every file that came in, good or bad.
 * The keyboard hint ("or paste with Ctrl V") is hidden on a touch screen (pointer: coarse), which has no keys to press.
 * `slim`: one "Add file" row instead of the zone (an empty side panel); drop and paste still work on it.
 */
interface FileDropProps {
  onAdd: (files: AddedFile[]) => void
  maxBytes?: number
  accept?: readonly string[]
  multiple?: boolean
  /** Listen for Cmd/Ctrl+V on the whole page. Default on. */
  pasteAnywhere?: boolean
  /** One "Add file" row instead of the drop zone (drop and paste still work). */
  slim?: boolean
  className?: string
}

export function FileDrop({
  onAdd,
  maxBytes = DEFAULT_MAX_BYTES,
  accept = DEFAULT_ACCEPT,
  multiple = true,
  pasteAnywhere = true,
  slim = false,
  className,
}: FileDropProps) {
  const input = useRef<HTMLInputElement>(null)
  const zone = useRef<HTMLDivElement>(null)
  const depth = useRef(0)
  const [over, setOver] = useState<number | null>(null)
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform)

  const take = async (list: FileList | File[] | null | undefined) => {
    const files = list ? [...list] : []
    if (!files.length) return
    onAdd(await intakeFiles(multiple ? files : files.slice(0, 1), { maxBytes, accept }))
  }
  const takeRef = useRef(take)
  takeRef.current = take

  useEffect(() => {
    if (!pasteAnywhere) return
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.defaultPrevented || (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName)))) return
      // An open dialog this zone is not part of (the capture sheet over an order) owns the paste.
      const modal = '[role="dialog"],[role="alertdialog"]'
      if (document.querySelector(modal) && !zone.current?.closest(modal)) return
      const files = [...(e.clipboardData?.files ?? [])]
      if (files.length) {
        e.preventDefault()
        void takeRef.current(files)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [pasteAnywhere])

  const onDragEnter = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    depth.current += 1
    setOver(e.dataTransfer.items.length || 1)
  }
  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setOver(null)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    depth.current = 0
    setOver(null)
    void take(e.dataTransfer.files)
  }

  const picker = (
    <input
      ref={input}
      type="file"
      multiple={multiple}
      accept={accept.join(',')}
      tabIndex={-1}
      aria-label="Choose files"
      className="sr-only"
      onChange={e => {
        void take(e.target.files)
        e.target.value = ''
      }}
    />
  )
  const pasteKeys = (
    <>
      <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
      <Kbd>V</Kbd>
    </>
  )

  if (slim) {
    return (
      <div
        ref={zone}
        role="group"
        aria-label="Add files"
        onDragEnter={onDragEnter}
        onDragOver={e => e.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          'flex min-h-touch flex-wrap items-center gap-x-3 gap-y-1 rounded border border-dashed px-2 py-1 text-sm text-fg-muted',
          over !== null ? 'border-2 border-brand-green bg-surface' : 'border-transparent',
          className,
        )}
      >
        {over !== null ? (
          <b className="font-medium text-fg" aria-live="polite">
            Release to add {over} {over === 1 ? 'file' : 'files'}
          </b>
        ) : (
          <>
            <Button size="sm" variant="quiet" icon={Plus} onClick={() => input.current?.click()}>
              Add file
            </Button>
            <span className="inline-flex flex-wrap items-center gap-1 [@media(pointer:coarse)]:hidden">or drop it here, or paste with {pasteKeys}</span>
          </>
        )}
        {picker}
      </div>
    )
  }

  return (
    <div
      ref={zone}
      role="group"
      aria-label="Add files"
      onDragEnter={onDragEnter}
      onDragOver={e => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'grid min-h-[180px] content-center justify-items-center gap-2 rounded border border-dashed px-5 py-8 text-center text-sm text-fg-2 transition-colors duration-fast ease-out',
        over !== null ? 'border-2 border-brand-green bg-surface' : 'border-line-input bg-sunken',
        className,
      )}
    >
      <span className={cn('grid size-[36px] place-items-center rounded border text-fg-2', over !== null ? 'border-line bg-selected' : 'border-line bg-surface')}>
        <Icon icon={Upload} size="lg" />
      </span>
      {over !== null ? (
        <>
          <b className="font-medium text-fg" aria-live="polite">
            Release to add {over} {over === 1 ? 'file' : 'files'}
          </b>
          <span className="text-fg-muted">
            {acceptLabel(accept)} · up to {formatBytes(maxBytes)} each
          </span>
        </>
      ) : (
        <>
          <b className="font-medium text-fg">Drop files here</b>
          <span className="inline-flex flex-wrap items-center justify-center gap-1 text-fg-muted">
            {/* A touch screen has no keys: the paste hint is for a keyboard and mouse only. */}
            <span className="inline-flex flex-wrap items-center gap-1 [@media(pointer:coarse)]:hidden">or paste with {pasteKeys} ·</span> up to {formatBytes(maxBytes)} each
          </span>
          <Button size="sm" onClick={() => input.current?.click()}>
            Choose files
          </Button>
        </>
      )}
      {picker}
    </div>
  )
}
