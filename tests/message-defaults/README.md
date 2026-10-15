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
The preview API in this browser fixture returns a small stub PDF. Actual bounded
Chromium layout, secure images, natural/explicit pagination, footer geometry,
numbering, oversized-content refusals, delivery snapshots, and real individual,
bulk, and event-notifier sender paths are separately verified without live
providers by:

```
npx vitest run tests/comm/message-defaults*.test.ts
```

For existing Studio, compose, and bulk source/apply regression coverage, also run
`npm run test:browser:postal-templates`.
