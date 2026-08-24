---
name: pdfmake lazy load order
description: Why pdfmake and its vfs_fonts blob must be dynamically imported sequentially, never in parallel.
---

The client loads pdfmake and its embedded font file on demand so the ~2 MB font
payload stays out of the initial page load. Those two dynamic imports must run
**sequentially — pdfmake first, fonts second.**

**Why:** the pdfmake browser build publishes itself as a global on evaluation,
and the font module's only real job is a side effect: on evaluation it looks for
that global and calls `addVirtualFileSystem` on it. `createPdf` resolves fonts as
`explicit vfs || globalVfs || global.pdfMake.vfs`, so that side effect is what
actually supplies the fonts. Assigning `pdfMake.vfs` from the font module's
default export looks like the real wiring but is only the last fallback — and the
common `pdfFonts.pdfMake?.vfs || pdfFonts.vfs` spelling evaluates to `undefined`
because the module's default export *is* the file map itself.

Static imports guaranteed this order for free. `Promise.all` over the two dynamic
imports does not: whichever chunk evaluates first wins, so on some loads the
fonts register against nothing and PDF generation fails with a missing-font error
that never reproduces locally.

**How to apply:** when moving a library behind a dynamic import, check whether it
or its companion modules communicate through a global set at evaluation time.
If they do, keep the awaits sequential and say so in a comment — the parallel
version is the one a later reader will "optimize" back in.
