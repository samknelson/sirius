---
name: FILESYSTEMS env registry
description: Conventions for the multi-filesystem file storage layer (FILESYSTEMS env var, providers, jail, ordering rules)
---

# FILESYSTEMS env registry

- Filesystems are defined ONLY by the `FILESYSTEMS` env var (JSON keyed by fs id) — never in code or DB. Provider settings keys ending `_secret` name env vars resolved at boot (exposed without the suffix). Malformed config throws at boot; fs ids referenced by `files` rows but unconfigured only WARN.
- **Why:** operators own storage topology; secrets must never be inlined in config JSON; missing config must degrade gracefully (503 `FileSystemNotConfiguredError`), not crash or silently 500.
- **How to apply:** any new file read/write goes through `fileSystemService` (server/services/files) with an explicit `fileSystemId` — internal app uploads use the conventional id `private`; pre-migration rows are on `legacy`. There is deliberately NO code default; `/api/files` requires `fileSystemId` in the body.
- Ordering invariants: create = write object first, insert row second; delete = delete row first, object second (failures leave sweepable orphan objects, never dangling rows).
- Local provider jail: lexical `path.resolve` prefix check is NOT enough — must also `lstat` (reject symlinks) + `realpath` containment against the realpath'd base, and skip symlinks during list walks, or symlinks under base_path escape the jail.
- Public serving: one guarded no-auth route `/public-files/:fsId/*` — 404 unless fs is configured AND public AND a live `files` row matches (fsId, storagePath); local streams from disk, replit/s3 redirect to a short signed URL.
