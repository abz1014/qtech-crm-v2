import { useEffect, useState } from 'react'
import { FileText, Image as ImageIcon, X } from 'lucide-react'
import { formatBytes, type AddedFile } from '@/lib/fileIntake'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'

/*
 * FileRow (INVENTORY: U07; D08 section 01). One added file: a 40px thumbnail
 * (the photo itself, or a document glyph), the name, and a mono line with its
 * size, with the shrink note when it was compressed ("3.8 MB → 640 KB"). A file
 * that could not be added shows its reason in danger tone instead
 * ("7.2 MB. The limit is 5 MB."). The remove button names the file.
 */
export function FileRow({ item, onRemove, className }: { item: AddedFile; onRemove?: () => void; className?: string }) {
  const { file, originalSize, error } = item
  const isImage = file.type.startsWith('image/')
  const [url, setUrl] = useState<string | null>(null)
  const [unreadable, setUnreadable] = useState(false)
  useEffect(() => {
    if (!isImage || error || typeof URL.createObjectURL !== 'function') return
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file, isImage, error])

  const shrunk = !error && isImage && file.size < originalSize
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-3 rounded border px-3 py-2 text-sm',
        error ? 'border-tone-danger-fg bg-tone-danger-bg' : 'border-line-strong bg-surface',
        className,
      )}
    >
      <span className="grid size-[40px] shrink-0 place-items-center overflow-hidden rounded border bg-selected text-fg-muted">
        {url && !unreadable ? <img src={url} alt="" onError={() => setUnreadable(true)} className="size-full object-cover" /> : <Icon icon={isImage ? ImageIcon : FileText} size="lg" />}
      </span>
      <span className="grid min-w-0 flex-1">
        <b className="truncate font-medium">{file.name}</b>
        <span className={cn('num text-xs', error ? 'font-medium text-tone-danger-fg' : 'text-fg-muted')}>
          {error ?? (shrunk ? `${formatBytes(originalSize)} → ${formatBytes(file.size)}` : formatBytes(file.size))}
        </span>
      </span>
      {onRemove ? <Button variant="quiet" size="sm" icon={X} aria-label={`Remove ${file.name}`} onClick={onRemove} className="text-fg-muted" /> : null}
    </div>
  )
}
