---
name: Navigation measurement and scroll width
description: Why invisible width probes in a navigation row still cause overflow
---

An absolutely positioned, `visibility: hidden` labeled-width probe inside a navigation row still contributes to that row's `scrollWidth`. Put the probe inside a zero-width, overflow-clipped wrapper and measure the probe's own bounding rectangle.

**Why:** An otherwise correct compact icon row appeared to overflow in the browser even though every visible icon fit. The hidden probe itself was enlarging the scrollable area.

**How to apply:** When measuring full-size content to choose a compact presentation, keep the measurement independent of the current presentation and contain its overflow so it cannot change the row being measured.