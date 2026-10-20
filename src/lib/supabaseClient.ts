import { AuthClient } from '@supabase/auth-js'
import { FunctionsClient } from '@supabase/functions-js'
import { PostgrestClient } from '@supabase/postgrest-js'
import { StorageClient } from '@supabase/storage-js'
import type { SupabaseClient } from '@supabase/supabase-js'

/*
 * The browser client, put together from the four parts the app uses: the database (PostgREST), auth, storage and edge
 * functions. supabase-js `createClient` always builds a Realtime client as well (realtime-js and phoenix, about 58 KB of
 * the entry chunk), and the app never opens a channel (invalidation.ts: realtime is out of scope). Audit 2, performance §1.2.
 *
 * This mirrors what supabase-js 2.117 `SupabaseClient` does for those four parts, so requests, sessions and the storage key
 * a signed-in phone already has are unchanged. supabaseClient.test.ts pins that behaviour and that the parts stay on the
 * same version as supabase-js (package.json pins them exactly; bump all five together).
 *
 * The type is supabase-js's own, narrowed to these parts: a call to `.channel()` is a type error, not a runtime surprise.
 */
export type LeanSupabaseClient<Database> = Pick<SupabaseClient<Database>, 'from' | 'rpc' | 'schema' | 'auth' | 'storage' | 'functions'>

/** Sent as X-Client-Info (supabase-js sends `supabase-js/<version>; runtime=web`); only used in Supabase's request logs. */
const CLIENT_INFO = 'supabase-js-parts/2.117.3; runtime=web'

const isNewApiKey = (key: string) => key.startsWith('sb_publishable_') || key.startsWith('sb_secret_')

function baseUrl(url: string): URL {
  const trimmed = url.trim()
  if (!/^https?:\/\//i.test(trimmed)) throw new Error('Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.')
  return new URL(trimmed.endsWith('/') ? trimmed : `${trimmed}/`)
}

export function createLeanClient<Database>(url: string, key: string, options: { fetch?: typeof fetch } = {}): LeanSupabaseClient<Database> {
  const base = baseUrl(url)
  if (!key) throw new Error('supabaseKey is required.')
  const headers = { 'X-Client-Info': CLIENT_INFO }
  const customFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init))

  // As supabase-js: the anon key as both apikey and bearer until a session exists, and the same storage key
  // (sb-<project ref>-auth-token), so a phone that is signed in stays signed in. Unset options are passed as undefined,
  // exactly as supabase-js passes them.
  const auth = new AuthClient({
    url: new URL('auth/v1', base).href,
    headers: { Authorization: `Bearer ${key}`, apikey: key, ...headers },
    storageKey: `sb-${base.hostname.split('.')[0]}-auth-token`,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: undefined,
    userStorage: undefined,
    flowType: 'implicit',
    lock: undefined,
    debug: undefined,
    throwOnError: undefined,
    experimental: undefined,
    fetch: customFetch,
    lockAcquireTimeout: undefined,
    skipAutoInitialize: undefined,
    hasCustomAuthorizationHeader: false,
  })

  /** Every database, storage and function request carries the signed-in person's token (supabase-js `fetchWithAuth`). */
  const withAuth = (omitKeyAsBearer: boolean): typeof fetch => {
    const keyAsBearer = !(omitKeyAsBearer && isNewApiKey(key))
    return async (input, init) => {
      const token = (await auth.getSession()).data.session?.access_token ?? null
      const h = new Headers(init?.headers)
      if (!h.has('apikey')) h.set('apikey', key)
      if (!h.has('Authorization')) {
        const bearer = token ?? (keyAsBearer ? key : null)
        if (bearer) h.set('Authorization', `Bearer ${bearer}`)
      }
      return customFetch(input, { ...init, headers: h })
    }
  }
  const dataFetch = withAuth(false)
  const functionsFetch = withAuth(true)
  const rest = new PostgrestClient(new URL('rest/v1', base).href, { headers, schema: 'public', fetch: dataFetch })
  const storage = new StorageClient(new URL('storage/v1', base).href, headers, dataFetch)
  const functionsUrl = new URL('functions/v1', base).href

  const client = {
    from: (relation: string) => rest.from(relation),
    rpc: (fn: string, args: object = {}, opts: { head?: boolean; get?: boolean; count?: 'exact' | 'planned' | 'estimated' } = { head: false, get: false, count: undefined }) =>
      rest.rpc(fn, args, opts),
    schema: (schema: string) => rest.schema(schema),
    auth,
    storage,
    get functions() {
      return new FunctionsClient(functionsUrl, { headers, customFetch: functionsFetch })
    },
  }
  return client as unknown as LeanSupabaseClient<Database>
}
