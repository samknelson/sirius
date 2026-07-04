---
name: Vite dev transform chokes on inline JSX generics
description: Why `<Component<Type>>` JSX syntax crash-loops the dev server even though standalone esbuild accepts it
---

Inline JSX generic type arguments — `<SharedConfigList<TSettings> .../>` — fail to
transform inside Vite's dev pipeline and surface as a server crash loop (root flaps
200/000). The error logged is an esbuild parse error like
`Expected ">" but found "<"` with a **phantom column number** that does not match the
real (short) source line — a tell-tale that the failure is in the transform layer,
not the literal characters at that position. The error rotates across files: it
appears for whichever module Vite is transforming on-demand at that moment.

**Why it's confusing:** running the SAME esbuild version standalone
(`npx esbuild file.tsx --jsx=automatic`) parses the file CLEAN. Only Vite's
on-demand transform path rejects it. So a green standalone esbuild check does NOT
prove the dev server will accept the file.

**Fix / project standard:** never put generic type arguments in a JSX tag. Drop the
`<Type>` from the element and recover the generic via an explicitly-typed callback
prop instead — e.g. annotate `renderSummary={(config: ChargePluginConfigRow<MySettings>) => ...}`.
TypeScript infers the component's generic from the typed callback parameter, so type
safety is preserved.

**How to apply:** when a dev-server crash loop appears right after a merge/feature,
grep for `<Identifier<` in the changed `.tsx` files. To verify a fix actually lands
in the running server, request the module through Vite directly
(`curl http://localhost:5000/src/.../File.tsx`) and confirm HTTP 200 with no
`Pre-transform error` — a standalone esbuild check is insufficient.
