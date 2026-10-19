import type { KeyboardEvent, ReactNode } from 'react'
import { Check, CircleAlert, Pencil, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'

/*
 * InlineEditRow (D08 section 13, components-13): a row captured in place, with no dialog. Four states of one row:
 *   resting   click any cell (or the pencil) to edit
 *   editing   the cells become fields on a sunken band with a 3px brand-green edge; Enter saves, Esc cancels,
 *             Tab moves to the next cell; Save is primary, Cancel quiet
 *   saving    the fields are read-only (the caller sets readOnly) and a spinner stands in for Save
 *   error     a validation line under the row, in danger tone, with the glyph; the fields stay open
 * The primitive owns the layout, the keys and the actions; the caller owns the fields and the validation.
 * Fields inside are drawn 28px tall (the row is a dense surface). Set the same `columns` on a header row of
 * the same grid (see the gallery) so the headings line up.
 */
export interface InlineEditColumn {
  /** CSS grid track: "minmax(0, 1.4fr)", "110px". */
  width: string
  align?: 'left' | 'right'
}

export interface InlineEditRowProps {
  /** One entry per cell; the actions column is added by the row. */
  columns: readonly InlineEditColumn[]
  /** Names the row for assistive tech and the buttons ("Karachi Valve House"). */
  label: string
  /** What each cell shows at rest. */
  cells: readonly ReactNode[]
  /** What each cell holds while editing or saving (fields, or plain text for cells that cannot change). */
  editCells: readonly ReactNode[]
  mode: 'resting' | 'editing' | 'saving'
  /** The validation line under the row. Only shown while editing. */
  error?: ReactNode
  onEdit: () => void
  onSave: () => void
  onCancel: () => void
  className?: string
}

const ACTIONS = '60px'

export function InlineEditRow({ columns, label, cells, editCells, mode, error, onEdit, onSave, onCancel, className }: InlineEditRowProps) {
  const editing = mode !== 'resting'
  const saving = mode === 'saving'
  const list = editing ? editCells : cells

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!editing || saving) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    } else if (e.key === 'Enter' && !e.shiftKey && !(e.target as HTMLElement).closest('button,textarea,a')) {
      e.preventDefault()
      onSave()
    }
  }

  return (
    <div className={cn('border-b border-line', className)}>
      <div
        role="group"
        aria-label={label}
        data-mode={mode}
        data-invalid={error ? '' : undefined}
        onKeyDown={onKeyDown}
        onClick={e => {
          if (!editing && !(e.target as HTMLElement).closest('a,button,input,select,textarea')) onEdit()
        }}
        style={{ gridTemplateColumns: [...columns.map(c => c.width), ACTIONS].join(' ') }}
        className={cn(
          'relative grid min-h-row items-center gap-2 px-3 text-sm',
          editing
            ? 'bg-sunken py-2 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-brand-green [&_input]:h-control-sm [&_input]:px-2 [&_input]:text-sm [&_select]:h-control-sm [&_select]:text-sm'
            : 'cursor-pointer bg-surface hover:bg-sunken',
        )}
      >
        {columns.map((c, i) => (
          <div key={i} className={cn('min-w-0', c.align === 'right' && 'text-right [&_input]:text-right')}>
            {list[i]}
          </div>
        ))}
        <div className="flex justify-end gap-[2px]">
          {!editing ? (
            <Button variant="quiet" size="sm" icon={Pencil} aria-label={`Edit ${label}`} onClick={onEdit} />
          ) : (
            <>
              <Button variant={saving ? 'secondary' : 'primary'} size="sm" icon={Check} aria-label={`Save ${label}`} busy={saving} onClick={onSave} />
              {saving ? null : <Button variant="quiet" size="sm" icon={X} aria-label={`Cancel editing ${label}`} onClick={onCancel} />}
            </>
          )}
        </div>
      </div>
      {error && editing ? (
        <div className="px-3 py-2">
          <p role="alert" className="flex items-start gap-[6px] text-xs font-medium text-tone-danger-fg">
            <Icon icon={CircleAlert} size="sm" className="mt-[calc((var(--lh-xs)-14px)/2)]" />
            <span>{error}</span>
          </p>
        </div>
      ) : null}
    </div>
  )
}
