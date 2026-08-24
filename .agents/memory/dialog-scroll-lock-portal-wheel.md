---
name: Dialog scroll lock swallows wheel over portaled popovers
description: Why a combobox/dropdown list refuses to scroll only when its form is rendered inside a modal Dialog, and the minimal fix.
---

# A portaled dropdown cannot scroll inside a modal Dialog

Radix `Dialog` (modal) wraps its content in `react-remove-scroll`, which
registers a **bubble-phase, non-passive `wheel`/`touchmove` listener on
`document`** and calls `preventDefault()` for any event that did not originate
inside the dialog's own subtree (or one of its declared `shards`).

`Popover`/`Select`/`Command` panels render through a portal on `document.body`,
i.e. *outside* that subtree. So the option list looks scrollable, has overflow,
and the wheel does nothing. The exact same component on a plain page scrolls
fine — no lock is mounted there.

**Fix:** put `onWheel`/`onTouchMove` handlers that only call
`event.stopPropagation()` on the scrollable element inside the portal (the
list, not the whole panel). React 18 attaches its listeners to portal
containers as well (`preparePortalMount`), and synthetic `stopPropagation`
calls the native one, so the event dies at `document.body` and never reaches
the lock's listener. Native scrolling still happens; React registers
`wheel`/`touchmove` as passive, which only forbids `preventDefault`, not
`stopPropagation`.

**Why not `<Popover modal>`:** it works (the popover's own lock becomes the
top of the lock stack), but it also turns on `disableOutsidePointerEvents`,
which is the classic source of `pointer-events: none` stuck on `<body>` and
dead clicks after close when nested in a dialog.

**How to apply:** only needed for a surface that can appear inside a modal
dialog. Outside a dialog no such document listener exists, so the handlers are
inert — shared form components can carry them safely.
