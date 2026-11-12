# Public Studio images

## Operator prerequisites

No deployment or external storage provisioning is performed by this change.
An authorized operator must:

1. Supply a public filesystem through the existing FILESYSTEMS settings.
   Never change the privacy of a filesystem containing private documents.
2. Configure a recipient-reachable HTTPS PUBLIC_URL.
3. Under **Config → Entity Files**, configure **Letter Templates**
   (`letter_template`), **Bulk Messages** (`bulk_message`), and/or
   **Workers Public Files** (`worker_public`). Use an explicit PNG/JPEG
   extension list and a directory such as `images/:entity-id`.
4. Keep every filesystem ID and object path used by existing published URLs
   available. Changing the upload destination does not move old images.

Studio's configuration ID is the area's registered key in
`entity_files_config`, not a UUID or token context ID. The host must also
supply an existing entity ID. Saved templates, existing bulk drafts, and
explicit worker compose targets support uploads. Notifier settings,
employer/provider compose, and message defaults do not. URL insertion and
editing existing images remain available.

## Irreversible publication

Uploading immediately publishes a PNG/JPEG of at most 1 MB. Multiple images
can belong to one record. Canceling edits, removing HTML images, deleting
the owner, and automatic cleanup do not revoke published URLs or remove
their bytes. Do not upload confidential content. Ordinary worker
attachments remain in their separate area.

## Upgrade

The forward migration runs transactionally and does not change file IDs,
filesystem IDs, paths, statuses, or bytes. It reparents an image only when an
exact managed image URL proves one saved template reference. Shared,
unreferenced, or ambiguous images are retained as published file records
without a fabricated owner. Valid public legacy configuration is copied only
to missing new areas; explicitly configured entries are preserved.

If the old filesystem is absent or private, it is not made public and its
configuration is not copied. Configure the new areas explicitly after
review. External storage permissions and recipient access still require
authorized environment-specific verification; local fixtures are not proof
of a staging or production deployment.

## Verification in this workspace

- Server/client TypeScript checks, all 16 architecture lint rules, migration
  checks, and whitespace checks passed.
- Focused upload, isolated PostgreSQL upgrade/lifecycle, postal image, help
  route, and filesystem-sweep checks passed (69 tests).
- Studio browser fixtures passed for saved template, bulk draft, worker,
  notifier, partial target, employer, and provider launches. Supported
  uploads/drop/apply/cancel and unsupported drop/paste/URL insertion were
  exercised without external storage or delivery.
- Built-in help listing and dialogs passed at desktop/mobile widths,
  including local-help coexistence and near-miss routes.
- The application restarted successfully and applied the forward migration.
  The live preview showed sign-in, not authenticated configuration pages.
- The broader message-defaults browser harness generated both postal preview
  PDFs but failed its mobile document-width assertion. This is not a passing
  full message-defaults browser run.
