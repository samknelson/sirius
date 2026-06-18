---
name: queryFn undefined overrides default fetcher
description: TanStack Query footgun — explicit queryFn:undefined disables a query's fetch instead of falling back to the QueryClient default.
---

Passing `queryFn: undefined` explicitly in a `useQuery` options object does NOT
fall back to the QueryClient's `defaultOptions.queries.queryFn`. During option
merging the explicit `undefined` overwrites the default, so the query ends up
with no fetcher and never issues a request. Symptom: the query stays with its
initial/empty data, no network call fires, and (because it never fetches)
`isLoading` is false — so the UI silently renders an empty/empty-state view.

**Why:** the app relies on a global default fetcher (`getQueryFn`) keyed off the
queryKey URL. Code that conditionally sets `queryFn: cond ? fn : undefined`
breaks the no-`fn` branch — that branch must use the default fetcher but the
explicit `undefined` kills it.

**How to apply:** never write `queryFn: cond ? fn : undefined`. Either omit the
`queryFn` key entirely when you intend the default fetcher, or supply a real
fetcher in every branch (e.g. `apiRequest("GET", url)`). This bit the
`/admin/plugin-configs/:kind` page: the unfiltered list silently never loaded.
