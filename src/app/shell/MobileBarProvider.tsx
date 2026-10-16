import { useMemo, useState, type ReactNode } from 'react'
import { BarSetter, BarValue, type MobileBarConfig, type SetBar } from '@/app/shell/MobileBarContext'

/** Holds the phone bar configuration for the shell (see MobileBarContext.tsx for the hook pages call). */
export function MobileBarProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<MobileBarConfig | null>(null)
  const set = useMemo<SetBar>(() => next => setConfig(next), [])
  return (
    <BarSetter.Provider value={set}>
      <BarValue.Provider value={config}>{children}</BarValue.Provider>
    </BarSetter.Provider>
  )
}
