# Data-layer conventions (R01)

One way to read and write server data, the same in every area. `src/features/companies/` is the
reference implementation: copy its shape.

## The rule

**Server state lives in TanStack Query. No React context holds it.**

A context that carries a list of companies, the current user's RFQs or a "loaded" flag becomes a second,
stale copy of the cache that nothing invalidates. Every screen reads through a query hook, so every screen
shares one cache and one refresh.

This is enforced: ESLint refuses `createContext` imported from `react` anywhere under `src/features/`
(`no-restricted-imports`, tested in `noServerStateContext.test.ts`). The app shell (`src/app`) keeps its
session and palette contexts: those are not server data. A feature that truly needs a UI-only context (a
wizard's step, a panel's open state) disables the rule on that line and writes the reason beside it.

## The pieces

```
src/lib/supabase.ts          the one client; reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
src/lib/queryClient.ts       the one QueryClient (a module singleton, so non-React code can share the cache)
src/features/queryKeys.ts    the key factory: qk.<area>.<key>(...)
src/features/invalidation.ts the invalidation map: which keys go stale after which write
src/features/dbTypes.ts      TableRow / ViewRow types from the generated schema
src/features/<area>/api.ts   the ONLY file that names a table, view or RPC
src/features/<area>/hooks.ts one hook per read, one per write
src/test/fakeSupabase.ts     a scriptable client for hook tests
```

### Keys: `qk`

Never type a key inline. Keys are hierarchical, so a prefix refreshes everything beneath it:

```ts
qk.companies.all                    // ['companies']
qk.companies.lists()                // every list and search
qk.companies.detail(id)             // one company and everything hung off it
qk.companies.part(id, 'sites')      // one slice; 'sites' is a typed word, so a typo is a compile error
```

Ids and filters go last. Keys hold plain data only (no functions, Dates or class instances). A new area adds
its own block to `queryKeys.ts` and does not edit another area's.

### Reads: one hook per view or table

```ts
export function useCompanySites(id: string | undefined) {
  return useQuery({
    queryKey: qk.companies.part(id ?? '', 'sites'),
    queryFn: () => api.listSites(id as string),
    enabled: Boolean(id),
  })
}
```

- A hook returns the TanStack result as it is (`data`, `isPending`, `isError`, `refetch`). It does not copy
  the data into `useState` or a context.
- Gate a query with `enabled`, not with an early return, so hooks stay unconditional. Money reads pass
  `enabled: role === 'admin'`: for anyone else the request is never made.
- `api.ts` returns typed rows (from `dbTypes.ts`) or small view-models. Joins that PostgREST cannot do across
  views are done there, once, not in components. Lists longer than 1000 rows go through `fetchAll`
  (PostgREST caps a request at 1000).
- Errors are thrown as the PostgREST error object (`unwrap`), so `mapPgError` turns them into a plain sentence.

### Writes: name the write, let the map decide what refreshes

```ts
export function useAddSite(companyId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input) => api.addSite({ ...input, companyId }),
    onSuccess: () => invalidateAfter(client, 'site.add', { companyId }),
  })
}
```

`invalidation.ts` is the one place that says what goes stale after a write:

```ts
'site.add':      v => [qk.companies.detail(v.companyId)],
'company.merge': v => [qk.companies.all, qk.rfqs.all, qk.orders.all, qk.companies.detail(v.keepId)],
```

- Name the write `<thing>.<verb>`. Add it to `WriteVars` (its inputs) and to `invalidates` (its keys); the
  compiler fails if one is missing.
- Prefer a prefix over a list of leaves. Over-refreshing is cheap; a stale screen is not.
- A write that moves rows between areas (a merge moves RFQs and orders) lists every area it touches.
- Pass the form's `requestId` (from `useSubmitForm`) as the new row's id. A retry then cannot add a second row.
- Optimistic updates are not the default. Use them only for a one-tap action with an Undo, and roll back on error.

### Access (DATA_MODEL section 10)

Row Level Security is the real gate; the app only mirrors it. Reads a role may not make are not made at all
(`enabled: false`), and the control is not rendered. Never rely on hiding alone.

### Errors and states

Every screen shows loading (`Skeleton`), empty (`EmptyState`, saying what is true and what happens next) and
error (`EmptyState mood="error"` or `Banner`, with `Try again` calling `refetch`). Write errors go through
`useSubmitForm`, which maps Postgres codes to plain sentences.

## Adding an area

1. Add its keys to `queryKeys.ts` and its writes to `invalidation.ts`.
2. `src/features/<area>/api.ts`: the calls, typed. Nothing else imports the Supabase client.
3. `src/features/<area>/hooks.ts`: the hooks, as above.
4. Tests: a hook test with `installFakeDb` (see `companies/hooks.test.tsx`), plus an end-to-end test for the
   journey against the CI database.
5. Screens import hooks (and types from `api.ts`), never its functions and never the client. Non-React code, such as a command-palette source, may call `api.ts` through `queryClient.fetchQuery` so it shares the cache.
