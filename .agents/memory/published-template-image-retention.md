---
name: Published template image retention
description: Why cancelled drafts and deleted/copied templates must not revoke managed image URLs.
---

Template-image uploads may belong to real templates, bulk drafts, or workers,
but ownership never authorizes revoking publication. Publication is retained
and immutable; there is no automatic deletion or reference-counting collector.

**Why:** Studio uploads happen before saving. Copied templates and previously
sent emails can reference the same image long after the originating form is
cancelled or its template is deleted. Current editable records cannot prove
that no recipient still needs the URL.

**How to apply:** Preserve published URLs and bytes when adding new image
formats, upload hosts or cleanup behavior. Treat form cancellation and removing
an image from HTML as editor-only actions, not asset deletion permission.

Browser checks must open the image section and verify the URL input is visible
before typing. A hidden file input can accept Puppeteer's uploadFile even when
its section was never opened; that success does not prove URL authoring.
**Why:** An outdated section label let upload checks pass while typed URLs went
to the editor rather than the hidden URL input.
