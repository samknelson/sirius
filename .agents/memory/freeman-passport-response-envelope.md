---
name: Freeman passport response envelope
description: Undocumented response wrapping and initial-date behavior of Freeman's legacy EDLS passport endpoint.
---

The Freeman webclient transport reports success at the outer envelope, but the operation has its own nested result. A successful sheet page is under `data.success === true` and `data.data.sheets`; a nested failure uses `data.success === false` and a provider message.

**Why:** The first importer run treated the outer success as the operation result and looked at the wrong nesting level, hiding the real refusal. The endpoint also rejects exactly January 1, 1970 because PHP `strtotime()` returns numeric zero and the legacy code treats it as false.

**How to apply:** Parse the two success layers explicitly. Use January 2, 1970 as the earliest migration cursor, and map nested provider failures to bounded application-owned explanations before returning them to a browser.