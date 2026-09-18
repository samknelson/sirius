---
name: Lob HTML pagination limits
description: Measured Lob test proofs contradict standard paged CSS; wrapper-only pagination cannot guarantee arbitrary HTML margins.
---

Do not rely on standard paged CSS to paginate HTML submitted to Lob.

**Why:** Test-mode proof PDFs inspected on 2026-09-17 ignored `@page` margins and sizes, repeated table headers/footers, and repeated fixed-position bands. Continuous flow could split a text line across the physical page boundary. Element side padding worked, as did explicit page breaks and `page-break-inside: avoid` for blocks that fit a sheet. Negative margins were truncated at breaks, allowing padded simple paragraphs to retain vertical margins, but that workaround cannot guarantee layout for oversized or nested blocks.

**How to apply:** Verify the actual returned PDF, not just a browser rendering. Use a real pagination engine for unrestricted multi-page letter HTML rather than claiming a per-block CSS workaround is general. Check production runtime availability before adopting a browser-based renderer; availability in Replit does not establish availability in the deployment image. Preserve the first-page address reserve and shared compose/notifier/preview geometry.

The owner approved server-generated PDFs rather than constraining letter content to fit a CSS workaround.

**Why:** Real short and two-page Lob proofs retained Chromium's pagination, including the normal continuation-page top margin; a wrapper-only approach could not meet that guarantee.

**How to apply:** Keep preview and mailing on the same PDF renderer. Never fall back to Lob-rendered HTML when local PDF generation fails. Preview annotations must be added after content rendering and never sent to the provider.