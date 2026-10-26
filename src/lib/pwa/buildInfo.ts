/*
 * Which build this window is running (owner asked 2026-10-26: "I can't tell which version I'm on"). The commit the host built
 * (vite.config.ts BUILD_ID, the same string /version.json publishes as `build`) and that commit's date. Shown as
 * "Version a1b2c3d · 26 Oct 2026" at the bottom of Settings and in the account menu (src/app/shell/VersionLabel.tsx).
 */
declare const __APP_BUILD__: string | undefined
declare const __APP_BUILT_ON__: string | undefined

export const RUNNING_BUILD: string = typeof __APP_BUILD__ === 'string' && __APP_BUILD__ ? __APP_BUILD__ : 'dev'
const BUILT_ON: string = typeof __APP_BUILT_ON__ === 'string' ? __APP_BUILT_ON__ : ''

export const shortBuild = (build: string): string => (build.length > 7 ? build.slice(0, 7) : build)

/** "26 Oct 2026" from an ISO date or date-time; '' when it is not one. */
export function formatBuildDate(iso: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!day) return ''
  const d = new Date(`${day[1]}-${day[2]}-${day[3]}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function versionLabel(build: string = RUNNING_BUILD, builtOn: string = BUILT_ON): string {
  const date = formatBuildDate(builtOn)
  return date ? `Version ${shortBuild(build)} · ${date}` : `Version ${shortBuild(build)}`
}
