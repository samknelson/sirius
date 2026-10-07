# Template Assets — BAO-STG rollout and evidence

## Status

**Awaiting authorized staging configuration, deployment and verification.**
No Flight Control, AWS or BAO-STG login access has been supplied to the
executor. Nothing in this document asserts that staging is configured.
Local route tests, an isolated PostgreSQL lifecycle test and browser fixtures
are not staging evidence. Do not send real email or postal mail for this test.

## Local verification (2026-10-07)

- `npm run check`: server/client type checks passed.
- `npm run lint`: all 16 architecture rules passed.
- `bash scripts/dev/check-migrations-merge.sh`: passed against both deployment
  branches; new migration is above their current version floor.
- `npx vitest run tests/server/template-assets.test.ts tests/server/template-assets-postgres.test.ts tests/comm/remote-letter-pdf.test.ts`:
  45 tests passed, including real isolated PostgreSQL adoption/rollback and
  concurrent attachment attempts. The route harness uses mocked providers;
  this does not prove external storage credentials or persistence.
- `node tests/template-assets/browser.mjs`: upload/drop/apply/cancel passed for
  saved-template, notifier, manual-compose and bulk-compose Studio wrappers,
  plus an explicit failed-upload case. APIs are intercepted local fixtures;
  actual signed-in host pages and staging providers still need operator checks.
- Local application restart ran adoption successfully and passed the schema
  drift gate. The unauthenticated preview displays the normal sign-in screen;
  the signed-in Entity Files configuration page was not visually verified.
- Two broader, unrelated checks were not green: the full
  `npm run test:browser:postal-templates` stopped on an editor selection-menu
  timeout, and `npx tsx scripts/check-migrations.ts` could not read an old
  renumbered `1103_remove_process_entity_metadata.ts` path in its historical
  contract helper. The targeted upload tests and deployment merge-number
  guard above passed; these failures are not staging evidence either.

## Before deployment

An authorized staging operator must:

1. Record the exact deployed revision and the candidate revision.
2. Export/snapshot the existing `FILESYSTEMS` configuration and the entire
   `entity_files_config` variable privately. Preserve **all** existing filesystem
   IDs, settings and area entries. Do not expose secret values in evidence.
3. Confirm an approved durable public object-storage location already exists.
   An ephemeral web-container directory is not durable across redeploys.
   Do not provision infrastructure or make any existing private filesystem
   public as part of this rollout.
4. Keep an old managed-image URL for comparison. Record its file ID, filesystem
   ID and storage path privately, or use a non-sensitive fixture.
5. Deploy the registered forward migration `1204_adopt_template_assets`.
   It runs through normal startup migrations, transactionally and idempotently.
   **Do not run schema push.** Migration adoption changes ownership only, not
   file IDs, filesystem IDs, object paths, uploaded attribution or stored HTML.
   Conflicting existing attachments fail the transaction rather than guessing.

## Required effective settings

Verify the *running web service*, not just a saved dashboard value:

- `PUBLIC_URL`: the actual BAO-STG HTTPS deployment origin, with no path,
  credentials, query or fragment. Obtain it from the staging operator/deployment
  configuration; do not substitute the development preview hostname. Its
  public `/public-files/...` endpoint must be reachable from outside the private
  network without authentication, VPN, SSO, proxy login, WAF challenges or IP
  restrictions. The rest of the application can remain authenticated.
- `FILESYSTEMS`: preserve the entire existing map and add/reuse a **public,
  durable** entry approved by the infrastructure owner. Example shape only:

  ```json
  {
    "template-assets-public": {
      "name": "Template Assets",
      "access": "public",
      "provider": "s3",
      "provider_settings": {
        "bucket": "<approved-existing-bucket>",
        "region": "<approved-region>",
        "prefix": "<approved-prefix>",
        "access_key_id_secret": "TEMPLATE_ASSETS_S3_ACCESS_KEY_ID",
        "secret_access_key_secret": "TEMPLATE_ASSETS_S3_SECRET_ACCESS_KEY"
      }
    }
  }
  ```

  This fragment is **not** a replacement for the full map. Secret-reference
  strings name runtime variables; never inline their values. Missing referenced
  secrets fail filesystem initialization. Provider upload, read, signed-URL and
  cleanup permissions must be supplied through the approved secrets mechanism.
  A Replit provider can instead use its registered `bucket_id` setting, if the
  staging operator has already approved that provider for this deployment.
- Config → Entity Files → **Template Assets**, stored in
  `entity_files_config` under `template_asset`. Merge this entry into the
  existing per-area map:

  ```json
  {
    "template_asset": {
      "file_system": "template-assets-public",
      "directory": "template-images/:entity-id",
      "allowed": ["png", "jpg", "jpeg"]
    }
  }
  ```

  The filesystem ID must match the effective registry. The directory is
  configurable; `:entity-id` is the durable reusable asset owner's ID, **not**
  a template or communication ID. An explicit PNG/JPEG extension list and a
  public filesystem are required at config save and at upload time.

### Flight Control environment vs in-app overrides

- Changes to the Flight Control **web-service environment** and referenced
  secrets require redeploying that service so new processes receive them.
  Changing a migration-runner environment alone does not configure the web
  service. Follow the authorized Flight Control deployment process; do not run
  the application's schema-push build script as an adoption workaround.
- A non-empty real environment value wins over an in-app override.
  An operator may explicitly release it using the project's existing
  empty/`__UNSET__` convention; only then can the in-app value become effective.
  Check the Environment Variables page's **effective value/source** rather
  than assuming a successful override save took effect.
- `PUBLIC_URL` is read at use time. `FILESYSTEMS` and its secret references are
  cached in the filesystem registry. After changing effective in-app settings,
  use Admin → Restart & Reload → **Filesystem registry**. If the override cache
  itself needs refreshing, reload **Environment-variable overrides** first.
  The admin API is `POST /api/admin/restart/reload` with
  `{"ids":["env-overrides","filesystems"]}`. Check each returned reload result.
  A registry reload cannot read a Flight Control environment change that has
  not reached the running container; redeploy for that case.
- Area configuration is database-backed and read on each upload; no redeploy
  is required for changing the directory/allowlist. That affects new uploads
  only. Keep old filesystem entries so old URLs continue to resolve.

## Required operator checks

Use only non-sensitive images (PNG and JPEG below 1 MB).

1. Sign in as an authorized staff user. In a **new, unsaved** test letter,
   open Studio and upload/drop an image. Capture the returned stable absolute
   HTTPS `/public-files/<filesystem>/<path>` URL. Save and reopen the letter.
2. Fetch that URL from an independent anonymous client, with **no cookies or
   auth headers**, and follow redirects. Record final status, raster content
   type, byte count and SHA-256. For example, run in the operator's shell:

   ```sh
   curl --fail --location --cookie '' --dump-header /tmp/template-image-headers \
     --output /tmp/template-image.bin "$TEST_IMAGE_URL"
   sha256sum /tmp/template-image.bin
   ```

   Do not attach credential-bearing signed redirect URLs or raw header dumps
   to evidence; report redacted status/content-type/hash. A 200 login page is
   not success. S3 redirects may expire, but the original app URL must remain
   stable and mint a fresh redirect.
3. Render a **postal preview only** with that image and the legacy image. Both
   must appear in the PDF. No real recipient or mailing operation.
4. Copy the image HTML to a second test template. Cancel an unsaved edit that
   uploaded an image and delete the first test template. Confirm the copied,
   previously published and cancelled-edit image URLs still work. Do not
   delete owner, attachment, file rows or objects.
5. Repeat upload through notifier configuration, manual compose and bulk
   compose. Do not submit/send these messages. Confirm effective-user
   attribution when testing masquerade as another authorized staff user.
6. Confirm PATCH/DELETE on published file and attachment endpoints refuses
   mutation (409 for an authorized requester), including the raw admin
   filesystem browser's replace/move/delete actions.
7. Confirm a known private worker/case document URL returns 404 on the
   anonymous public route. Never attach its bytes or identifiers to evidence.
8. Redeploy the same approved revision. Fetch the **original** new and legacy
   URLs anonymously again and compare raster bytes/hashes. Reopen the saved
   template and repeat postal preview. This is the required durability proof.
9. Check migration/startup logs and the shared orphan sweeps: adopted asset
   owners exist and valid attachments are not identified as orphans.

## Evidence record — operator must fill in

| Evidence | Observed result |
|---|---|
| Operator date / approved staging deployment | Not performed |
| Deployed revision / migration outcome | Not performed |
| Effective PUBLIC_URL origin and source (env/override) | Not confirmed |
| Filesystem ID, public access, durable provider, prefix; source (no secrets) | Not confirmed |
| Effective Template Assets directory and PNG/JPEG allowlist | Not confirmed |
| Unsaved upload/drop + saved reopen | Not performed |
| Anonymous new + legacy retrieval: status, MIME, size, hash | Not performed |
| Postal preview shows old/new images, no send | Not performed |
| Notifier/manual/bulk + masquerade attribution | Not performed |
| Cancel/copy/delete-template retention + mutation refusal | Not performed |
| Private-file anonymous refusal | Not performed |
| Original URLs survive redeploy: before/after hash + preview | Not performed |
| Adoption/orphan-sweep results | Not performed |

Do not replace “Not performed” with local fixture results.

## Safe rollback / stop

Disable **new uploads** by turning off only the Template Assets area (remove
only `template_asset` from `entity_files_config`, preserving other entries).
Keep the public filesystem mapping, all owners, attachments, file rows, bytes
and the compatible public/postal readers. Restore prior configuration only if
it preserves every filesystem containing published images.

Do not blindly revert to an old application that only recognizes
`entity_type='template-asset'` in the legacy hardcoded directory: adopted
ownership and new configured directories require the compatible reader.
For a code rollback, an operator must deploy a compatibility-preserving build
that still reads both shapes. Do not undo adoption, move objects, delete images,
or rewrite previously saved/sent HTML.
