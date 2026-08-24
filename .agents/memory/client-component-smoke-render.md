---
name: Client component smoke-render harness
description: How to actually exercise a React component in this repo when it only exists behind a modal.
---

Many admin UI components here are only reachable by clicking through a
dialog (no route, no query param opens them), so neither a screenshot nor
a route test can verify them.

The rule: render the component with `react-dom/server`'s
`renderToStaticMarkup` and assert on the stripped text / `data-testid`s.

**Why:** it is the only cheap way to prove a component mounts, reads its
props correctly, and produces the intended structure. `tsc` only proves
types; a Vite transform only proves it parses.

**How to apply:**
- Write it as a real Vitest file under `tests/<subject>/*.test.tsx` and run
  `npm test`. The runner resolves `@/*` and `@shared/*` and compiles JSX
  with the automatic runtime, so a component no longer dies with
  `ReferenceError: React is not defined`.
- The obsolete predecessor of this was a throwaway `.tsx` script at the
  repo root plus a temp tsconfig overriding the root's `jsx: "preserve"`.
  Don't go back to that — a root-level `tmp-*.tsx` probe is a test with
  nowhere to live.
- Wrap anything using TanStack Query in a `QueryClientProvider`; with no
  server the query just stays empty, which is a useful "catalog hasn't
  loaded yet" case.
- Stub RJSF field props by hand (`schema`, `formData`, `onChange`,
  `registry.formContext`, `fieldPathId`).
