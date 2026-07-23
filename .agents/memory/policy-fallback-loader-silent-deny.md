---
name: Policy fallback entity loaders fail silently for non-staff
description: Wrong optional-chained storage method names in the policy-context fallback loader map deny access only for non-admin users
---

The access-policy `loadEntity` fallback map in `server/services/policy-context.ts` calls storage methods with optional chaining (`storage.files?.getFileById?.(id)`). If the method name is wrong, it silently returns undefined → the policy reports "entity not found" → 403.

**Why:** Admin/staff bypass policy evaluation entirely ("Admin bypass"), so a broken loader is invisible to internal testers and only bites external users (employers). Symptom seen in prod: employer CSV downloads via `<a download>` anchors saved the 403 JSON body as the "downloaded" file.

**How to apply:** When adding a policy entity type, verify the storage method actually exists (never trust optional chaining), or register a real loader via `registerEntityLoader`. When a non-staff user reports "JSON instead of a file", check deployment logs for 403 responsePreview on the download route — the JSON body is the error.

Related: `files.uploadedBy` stores the USER id; policies must compare against user id (contact id accepted for legacy rows).
