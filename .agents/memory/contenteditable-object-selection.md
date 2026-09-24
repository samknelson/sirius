---
name: Contenteditable object selection
description: Browser object clicks and token-marker hydration can invalidate authoring targets.
---

Treat browser object clicks as distinct from text-caret selection, and do not rehydrate an editor from its own serialized echo.

**Why:** Chromium can report a collapsed caret beside a clicked image; a subsequent selection observer then clears the image target. Replacing DOM on blur also invalidates saved ranges even when the serialized content is unchanged, especially when attribute-token placeholders are regenerated.

**How to apply:** Explicitly select an image or page-break node before observing selection. Keep attribute placeholders stable for the active document, distinguish external replacements from local echoes, and test editing object properties after focus moves into toolbar controls.