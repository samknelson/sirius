# Site-wide message defaults verification

Run `npm run test:browser:message-defaults`.

This isolated Vite fixture mounts the shipped Email Settings, Postal Settings,
individual email compose, Help display/dialogs, and Help listing. All API requests
are intercepted; unexpected requests fail closed. It never changes the running
application's configuration or sends messages.

Coverage includes independent persistence across reloads, clear/save, dirty state,
unsaved previews, load/save errors and retry, compose body isolation, the shipped
built-in Help entries alongside local help, and mobile horizontal fit. The mobile
screenshot is written to ignored `generated-artifacts/message-defaults/`.

The signed-in UI is exercised with fixture authentication, not a real user session.
Settings and Postal TokenStudio previews call the real Express preview handlers
and shared Chromium PDF renderer under the application's `tsx` runtime. Only
authentication, database storage, and vendor-image I/O boundaries are replaced.
The shipped letter-template detail page uses an equivalent synthetic record;
the fixture never reads or edits a private saved template. PDF responses are
saved under ignored `generated-artifacts/message-defaults/` for visual inspection.
Email settings previews use the real defaults validation/composition handler.

Actual bounded Chromium layout, secure images, natural/explicit pagination, footer geometry,
numbering, oversized-content refusals, delivery snapshots, and real individual,
bulk, and event-notifier sender paths are separately verified without live
providers by:

```
npx vitest run tests/comm/message-defaults*.test.ts
npx vitest run tests/comm/postal-runtime.test.ts
```

The runtime regression suite launches a separate `tsx` process and a Node process
running an esbuild ESM/splitting/packages-external bundle (without `npm run build`,
which runs database-push). Neither process boots the app or accesses a database.
It covers empty/head-only/footer-only/counts-only/combined defaults, short and
multipage bodies, real image decode, both HTTP preview entry points, safe errors,
PDF text/geometry, and preview-only guides. This matters because Vitest's
transform does not reproduce `tsx`'s inferred-function-name helper injection.

For existing Studio, compose, and bulk source/apply regression coverage, also run
`npm run test:browser:postal-templates`.

The existing built-in message-defaults and compose Help remains unchanged:
this repair restores its documented preview behavior without introducing a
control, workflow, permission, branding rule, or new layout limit.

## Repair verification

- Reproduced `ReferenceError: __name is not defined` at the real browser
  layout evaluation using synthetic content in a separate `tsx` process.
  Inspection of the name-preserving transform confirmed that the nested
  width-check function acquired an out-of-realm helper reference.
- The original renderer passed the default production esbuild transform
  (name preservation off) but failed with names preserved. The fixed renderer
  passes both the actual development runtime and production-shaped bundle.
- Runtime, defaults, preview-error, PDF geometry/rendering, queue, SVG/image,
  and delivery-snapshot suites passed (72 tests). Both message-defaults and
  postal-template browser suites passed, including the existing Email Studio
  preview. `npm run check` and all 16 `npm run lint` rules passed.
- Visually inspected the generated first page and continuation-page PDFs.
  Letterhead appears only on page one, footer/counts repeat, and the preview
  guides leave the address reserve and printable geometry intact.
- The running app restarted successfully. Opening the reported template
  `/admin/letter-templates/dcdf67a6-6e28-4561-b5ea-e732d1cbce2b` showed sign-in;
  its API returned 403 without a session. That exact record and the running
  app's signed-in UI were **not** verified. The isolated browser test instead
  exercises an equivalent record using the shipped detail page, TokenStudio,
  and actual PDF handler/renderer, with saved synthetic site-wide defaults.
- No live defaults/templates were edited, no migration or database-push
  command was run, and no mailing provider was contacted for verification.
