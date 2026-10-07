---
name: Published template image retention
description: Why cancelled drafts and deleted/copied templates must not revoke managed image URLs.
---

Template-image uploads belong to durable reusable assets, not to a saved
template or communication. For this rollout, publication is retained and
immutable; there is no automatic deletion or reference-counting collector.

**Why:** Studio uploads happen before saving. Copied templates and previously
sent emails can reference the same image long after the originating form is
cancelled or its template is deleted. Current editable records cannot prove
that no recipient still needs the URL.

**How to apply:** Preserve published URLs and bytes when adding new image
formats, upload hosts or cleanup behavior. Treat form cancellation and removing
an image from HTML as editor-only actions, not asset deletion permission.
