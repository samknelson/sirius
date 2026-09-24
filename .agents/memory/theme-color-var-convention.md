---
name: Theme colour variables hold whole colours
description: Why `hsl(var(--x))` is always wrong in this project, how it fails silently, and what enforces it.
---

Theme variables in this project already hold a **complete colour**
(`--chart-1: hsl(221 83% 53%)`). A call site names the variable and nothing
more: `var(--chart-1)`.

The widely-copied shadcn/ui examples use the opposite convention — the variable
holds bare channel values (`221 83% 53%`) and each call site wraps it in
`hsl()`. Pasting one of those in produces a colour nested inside a colour.

**Why this matters more than it looks:** it is the quietest possible failure.
A custom property accepts nearly any token sequence, so `--color-x:
hsl(hsl(221 83% 53%))` is declared without complaint. The value is only
rejected later, when substituted into `stroke` or `color`, and a property
invalid at computed-value time is simply dropped. Neither tsc nor the browser
console says a word. A chart shipped this way renders its grid, axes, tooltip
and labels perfectly while the series line is never painted — it reads as "no
data" when the data is fine. Verified directly: the wrapped form paints
nothing at all, including tooltip swatches (`background-color`).

**How to apply:** whenever writing a colour that comes from the theme — a
chart config `color`, an inline `<style>` block, a Tailwind arbitrary value
like `shadow-[0_0_0_1px_var(--sidebar-border)]` — reference the variable
directly. If you are copying styling from shadcn/recharts documentation, check
how the variable is *declared* here before copying the wrapping.

Enforced by the `theme-color-vars` lint rule, which learns which variables hold
a whole colour by reading the theme stylesheet, so it follows the theme instead
of hardcoding names. Two gotchas that cost a round each when writing it, worth
remembering for any regex-based source rule: `\b` does **not** anchor before a
function name inside a Tailwind arbitrary value (underscores stand in for
spaces, and `_` is a word character), and scanning line-by-line misses a
wrapper a formatter split across lines.
