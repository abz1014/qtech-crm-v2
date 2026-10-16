import { describe, expect, it } from 'vitest'
import { assertTargetAllowed, GuardError, LEGACY_PROJECT_REF } from '../src/load/guard'

const NEW_REF = 'abcdefghijklmnopqrst' // a made-up 20-character ref
const jwt = (claims: Record<string, unknown>) => {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b({ alg: 'HS256', typ: 'JWT' })}.${b(claims)}.signature`
}
const SERVICE = jwt({ role: 'service_role', iss: 'supabase-demo' })
const none = { iKnowThisIsLive: false, allowProjectRefs: [] as string[] }
const live = (ref = NEW_REF) => ({ iKnowThisIsLive: true, allowProjectRefs: [ref] })
const refuses = (f: () => unknown, pattern: RegExp) => {
  expect(f).toThrow(GuardError)
  expect(f).toThrow(pattern)
}

describe('the load target guard', () => {
  it('lets a local stack through with no flags', () => {
    for (const url of ['http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321', 'http://api.localhost:54321']) {
      expect(assertTargetAllowed(url, SERVICE, none)).toMatchObject({ kind: 'local', ref: null })
    }
  })

  it('refuses the legacy project hard, with every flag and allowlist', () => {
    const url = `https://${LEGACY_PROJECT_REF}.supabase.co`
    refuses(() => assertTargetAllowed(url, SERVICE, none), /legacy project/)
    refuses(() => assertTargetAllowed(url, SERVICE, live(LEGACY_PROJECT_REF)), /legacy project/)
    refuses(() => assertTargetAllowed(url.toUpperCase(), SERVICE, live(LEGACY_PROJECT_REF)), /legacy project/)
    refuses(() => assertTargetAllowed(`${url}/rest/v1/`, jwt({ role: 'service_role', ref: LEGACY_PROJECT_REF }), live(LEGACY_PROJECT_REF)), /legacy project/)
  })

  it('refuses the legacy project even when it is hidden in a local-looking URL, a path, or the key', () => {
    refuses(() => assertTargetAllowed(`http://localhost:54321/${LEGACY_PROJECT_REF}`, SERVICE, none), /legacy project/)
    refuses(() => assertTargetAllowed('http://127.0.0.1:54321', jwt({ role: 'service_role', ref: LEGACY_PROJECT_REF }), none), /legacy project/)
    refuses(() => assertTargetAllowed(`https://${NEW_REF}.supabase.co`, jwt({ role: 'service_role', ref: LEGACY_PROJECT_REF }), live()), /legacy project/)
  })

  it('refuses a live project without --i-know-this-is-live', () => {
    refuses(() => assertTargetAllowed(`https://${NEW_REF}.supabase.co`, SERVICE, { iKnowThisIsLive: false, allowProjectRefs: [NEW_REF] }), /live project/)
  })

  it('refuses a live project that is not in the allowlist', () => {
    refuses(() => assertTargetAllowed(`https://${NEW_REF}.supabase.co`, SERVICE, { iKnowThisIsLive: true, allowProjectRefs: [] }), /allowlist/)
    refuses(() => assertTargetAllowed(`https://${NEW_REF}.supabase.co`, SERVICE, live('zzzzzzzzzzzzzzzzzzzz')), /allowlist/)
  })

  it('lets a live project through only with the flag AND an allowlist match', () => {
    expect(assertTargetAllowed(`https://${NEW_REF}.supabase.co`, SERVICE, live())).toMatchObject({ kind: 'live', ref: NEW_REF })
    expect(assertTargetAllowed(`https://${NEW_REF}.supabase.co`, SERVICE, { iKnowThisIsLive: true, allowProjectRefs: [NEW_REF.toUpperCase()] })).toMatchObject({ ref: NEW_REF })
  })

  it('refuses hosts that are neither local nor a hosted project', () => {
    refuses(() => assertTargetAllowed('https://example.com', SERVICE, live()), /neither a local stack/)
    refuses(() => assertTargetAllowed('https://db.internal.example', SERVICE, live()), /neither a local stack/)
    refuses(() => assertTargetAllowed(`https://${NEW_REF}.supabase.co.evil.example`, SERVICE, live()), /neither a local stack/)
    refuses(() => assertTargetAllowed(`https://evil.example/${NEW_REF}.supabase.co`, SERVICE, live()), /neither a local stack/)
  })

  it('refuses a bad URL, a URL with credentials, a non-http scheme, and missing input', () => {
    refuses(() => assertTargetAllowed('not a url', SERVICE, none), /not a valid URL/)
    refuses(() => assertTargetAllowed('http://user:pw@127.0.0.1:54321', SERVICE, none), /credentials/)
    refuses(() => assertTargetAllowed('ftp://127.0.0.1', SERVICE, none), /http or https/)
    refuses(() => assertTargetAllowed('', SERVICE, none), /No target URL/)
    refuses(() => assertTargetAllowed('http://127.0.0.1:54321', '', none), /No service-role key/)
  })

  it('refuses a key that is not a service-role key', () => {
    refuses(() => assertTargetAllowed('http://127.0.0.1:54321', jwt({ role: 'anon' }), none), /not service_role/)
    refuses(() => assertTargetAllowed(`https://${NEW_REF}.supabase.co`, jwt({ role: 'authenticated', ref: NEW_REF }), live()), /not service_role/)
    refuses(() => assertTargetAllowed(`https://${NEW_REF}.supabase.co`, 'sb_publishable_abc', live()), /neither a service-role JWT/)
  })

  it("refuses a hosted key that belongs to a different project than the URL", () => {
    refuses(() => assertTargetAllowed(`https://${NEW_REF}.supabase.co`, jwt({ role: 'service_role', ref: 'zzzzzzzzzzzzzzzzzzzz' }), live()), /different project/)
    expect(assertTargetAllowed(`https://${NEW_REF}.supabase.co`, jwt({ role: 'service_role', ref: NEW_REF }), live())).toMatchObject({ kind: 'live' })
    expect(assertTargetAllowed(`https://${NEW_REF}.supabase.co`, 'sb_secret_abc', live())).toMatchObject({ kind: 'live' })
  })
})
