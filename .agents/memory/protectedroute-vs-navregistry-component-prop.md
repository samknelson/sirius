---
name: ProtectedRoute vs nav-registry component-gate prop names diverge
description: The same "gate by component" concept uses different prop names in client ProtectedRoute vs navigation-registry; mixing them silently fails to gate.
---

The component-gating concept is spelled differently in two client places:

- `client/src/components/auth/ProtectedRoute.tsx` uses **`component`** (also
  `componentAll` / `componentAny`). There is **no** `requiresComponent` prop.
- `client/src/lib/navigation-registry.ts` nav items use **`requiresComponent`**
  (and `requiresComponents`).

**Why:** They are separate type systems. TSX will type-error if you pass
`requiresComponent` to `ProtectedRoute`, but it is easy to copy the nav-registry
spelling into a route by habit. If the wrong prop ever slipped past (e.g. via
`any`), the route would render **ungated** instead of failing loudly.

**How to apply:** When adding a gated route, gate with `component="x"` on
`ProtectedRoute`; when adding the matching sidebar item, gate with
`requiresComponent: "x"` in navigation-registry. Don't swap them.
