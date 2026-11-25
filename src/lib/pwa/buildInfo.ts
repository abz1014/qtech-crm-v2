/*
 * Which build this window is running (owner asked 2026-10-26: "I can't tell which version I'm on"). The commit the host built
 * (vite.config.ts BUILD_ID, the same string /version.json publishes as `build`) and that commit's date. Shown as
 * "Build 26 Oct 2026" at the bottom of Settings and in the account menu (src/app/shell/VersionLabel.tsx). The commit code
 * means nothing to most people (screen review 2026-11-24, item 21): an admin sees it after the date, everyone else has it
 * in the label's tooltip, so support can still ask for it.
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

/** "Build 26 Oct 2026", or with the code "Build 26 Oct 2026 · a1b2c3d". With no date (a dev build) the code is the label. */
export function versionLabel(build: string = RUNNING_BUILD, builtOn: string = BUILT_ON, withCode = false): string {
  const date = formatBuildDate(builtOn)
  if (!date) return `Build ${shortBuild(build)}`
  return withCode ? `Build ${date} · ${shortBuild(build)}` : `Build ${date}`
}

/** The tooltip: "Version a1b2c3d", the code support asks for. */
export function versionCode(build: string = RUNNING_BUILD): string {
  return `Version ${shortBuild(build)}`
}
