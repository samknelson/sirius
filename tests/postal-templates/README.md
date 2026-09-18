# Saved postal templates: real-browser frontend regression

Run from the repository root:

```sh
npm run test:browser:postal-templates
```

Uses existing `puppeteer-core`, Vite and React dependencies. Install Chromium
using your platform's package manager if needed, then set
`CHROMIUM_PATH=/absolute/path/to/chromium`. The runner also checks common Linux
paths and `/repl/tools/bin/chromium`. It launches isolated Vite on loopback port
5188 (`POSTAL_BROWSER_PORT` overrides), never the application server. No DB,
secrets, application environment file, login provider or postal provider is used.

This is **not database E2E or a real login test**. Puppeteer intercepts the
authenticated staff `/api/auth/user` response and every backend request. A small
test-only shell mounts production `AuthProvider`, `CommPostal` (including
`ComposeTemplateStudio`) and the complete production bulk content page/layout at
their normal URL patterns. The full application router/protected layout and worker
record loader are outside this test. No editor, template-selection, confirmation,
Apply or save logic is copied or mocked.

The fixture returns one compatible saved Postal Letter Template and checks both
postal medium and each host's context query. Compatibility filtering, token
evaluation, permissions, server validation and database persistence are not tested.
Templates contain literal HTML/text deliberately; render responses echo the
fixture values. The PDF response is inert fixture data, not a PDF-rendering test.

Assertions exercise the actual contenteditable rich-text DOM with keyboard input:

- Selecting the saved template fills `bodyHtml` and `description` in each host.
- After editing both fields, overwrite Cancel preserves both, Confirm replaces both.
- One-off Done/Apply calls the render API with both fields and updates both form fields.
- Bulk Save sends the exact expected postal payload to a stateful fixture.
  Full reload performs a fresh GET, then reopening the Studio displays both persisted
  values (not just retained React state).
- Unknown API requests, external network requests, writes outside the allowlist,
  and uncaught browser errors fail the run. No send endpoint is allowed.

Success writes `screenshots/postal-template-regression.png` and prints assertions.
`POSTAL_BROWSER_KEEP_OPEN=1` retains the fixture browser and Vite until Ctrl+C for
inspection. Interception belongs to that Puppeteer page: a separate screenshot
browser cannot authenticate/use the fixture APIs. Inspect the saved PNG instead.
The `.mjs` runner is intentionally not collected by Vitest; use the npm script.