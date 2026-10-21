import { Fragment, useMemo } from 'react'
import { Keyboard } from 'lucide-react'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Kbd } from '@/ui/Kbd'
import { GROUP_NOTES, KEY_WORDS, SHORTCUT_GROUPS, shortcutList, type Shortcut } from '@/app/shell/shortcuts'

/*
 * Keyboard shortcuts sheet (spec round 2, 4.2). A 520 px dialog drawn from the one list in shortcuts.ts, in its five
 * groups. Opened by `?` outside a text box, the account menu (desktop) and the palette's "Keyboard shortcuts" action.
 * Loaded lazily by PaletteHost: it costs nothing until someone asks for it.
 */
export function ShortcutsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const list = useMemo(() => shortcutList(), [])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Keyboard shortcuts" icon={Keyboard} size="md">
        {SHORTCUT_GROUPS.map(group => {
          const rows = list.filter(s => s.group === group)
          const id = `shortcuts-${group.replace(/\W+/g, '-').toLowerCase()}`
          return (
            <section key={group} aria-labelledby={id} className="grid gap-2">
              <h3 id={id} className="text-base font-semibold text-fg">
                {group}
              </h3>
              {GROUP_NOTES[group] ? <p className="text-sm text-fg-2 text-pretty">{GROUP_NOTES[group]}</p> : null}
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2">
                {rows.map(s => (
                  <Fragment key={`${s.what}|${s.keys.join(' ')}`}>
                    <dt className="text-sm text-fg">
                      {s.what}
                      {s.where ? <span className="block text-xs text-fg-muted">{s.where}</span> : null}
                    </dt>
                    <dd className="flex flex-wrap items-center justify-end gap-1 self-start">
                      <Keys keys={s.keys} />
                    </dd>
                  </Fragment>
                ))}
              </dl>
            </section>
          )
        })}
      </DialogContent>
    </Dialog>
  )
}

function Keys({ keys }: { keys: Shortcut['keys'] }) {
  return (
    <>
      {keys.map((k, i) =>
        KEY_WORDS.has(k) ? (
          <span key={i} className="px-[2px] text-xs text-fg-muted">
            {k}
          </span>
        ) : (
          <Kbd key={i}>{k}</Kbd>
        ),
      )}
    </>
  )
}
