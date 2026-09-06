---
name: Timezone model
description: Naive timestamp columns store wall clock in the process zone; the site zone is process.env.TZ, not a threaded parameter. Why converting to timestamptz was rejected.
---

# How time zones work here

## The storage contract (verified, not assumed)

Core tables use `timestamp without time zone`. The driver serializes a JS Date
using the **process local offset**, and the naive column keeps only the
wall-clock fields; reading it back reinterprets those fields in the process
zone. Measured:

```
TZ=<unset>            12:00Z -> stored 12:00     "08:00" read back -> 08:00Z
TZ=America/New_York   12:00Z -> stored 08:00     "08:00" read back -> 12:00Z
```

Writes and reads agree as long as the process zone is stable, and the process
zone is the *only* thing that decides what stored history means.

**The matching hazard:** a column default of `now()` is evaluated by POSTGRES,
using the *session* TimeZone, not Node's. If the two disagree, app-written
timestamps and defaulted ones land in the same column offset from each other.
Both zones must be set together — the pg pool sets the session zone on every
connection checkout.

## The decision

The site zone is `process.env.TZ`, registered as an environment variable and
applied once at boot. Storage is not zone-aware and must not become so.

**Why:** setting the process zone fixes day buckets, cron schedules, heartbeat
day boundaries and all server-side formatting in one line, with zero call-site
changes — because it is the mechanism the naive-column schema already assumes.
The alternative (columns to `timestamptz`, or threading a zone through the
storage layer and ~270 display sites) was priced out and rejected by the owner
as far more expensive than the problem.

**Accepted costs — these are not bugs, do not "fix" them:**
- Changing the site zone re-interprets ALL stored history by the offset.
  Expected to happen approximately never after installation.
- If the zone observes DST, the repeated fall-back hour stores
  indistinguishable, unorderable rows. Recurs annually; accepted as small.
- The dispatch seniority date is `timestamptz` and so behaves differently from
  every other column under a zone change.

**Do not** reach for the shortcut in reverse either: nothing may set `TZ`
casually, because it silently rewrites the meaning of the whole database.

## Boot ordering: an in-app override must be read before the first write

The site zone can be supplied either by the real environment or by an in-app
override row, and override rows live in the database. The normal override cache
is installed *after* the schema bring-up — far too late, because migrations and
boot-time seeding already wrote timestamps by then, and a zone applied
afterwards cannot repair rows written in the old one.

**The rule:** anything that must be in force before the first write cannot wait
for the override cache. Read its single row directly, fail-soft (the table may
not exist on a first install, and the database may be unreachable — both are
the bring-up's failure to report, not the peek's), and keep the later cache
read as a no-op safety net that warns if it ever actually moves the value.

**Generalizes:** the same shape applies to any future setting that changes the
meaning of what gets written rather than merely how the app behaves.

## The browser half

There is no client-side equivalent of `TZ` — the browser's zone is read-only.
Per-user display zones are done by redirecting **formatters**, in two ways:

- The built-in locale formatters (`Intl.DateTimeFormat`, `Date.prototype.
  toLocale*String`) are patched globally at the entry point, injecting the zone
  only when the caller named none. Zero file edits.
- The date library's `format` reads raw local field getters and cannot be
  redirected that way. Patching the getters at the *prototype* level would
  corrupt date **arithmetic**, because the library round-trips through them
  internally — permanently off the table. Its imports are swapped to a project
  wrapper instead, held in place by an architecture-lint rule.

**A patched formatter lies about the zone.** Once the `Intl` patch is
installed, anything that asks the runtime what zone it is in gets the *injected*
answer back. The browser's real zone must be captured at module load, before
installation, or the "is the display zone different from the browser's?"
comparison silently answers no forever.

### Feeding a field-reading formatter another zone

The obvious move — shift the timestamp by the difference between the two zones'
offsets, let the formatter read local fields — is wrong twice, and the second
one is unfixable:

1. The offset difference is measured at the *original* instant while the fields
   are read at the *shifted* one. Any shift stepping over a DST boundary **in
   the browser's own zone** reads fields an hour off.
2. Even computed perfectly, the target wall clock has to exist as a
   browser-local instant. It does not, for the hour the browser's zone skips
   each spring — so a viewer there cannot be shown that hour of any other zone
   at all.

The construction that works: a **`Date` subclass per zone** whose field getters
answer from `Intl` while the time value stays the true instant. Nothing has to
be representable locally, so there is no gap. Two things this needs that are
easy to miss — the subclass must be per zone rather than per instance, because
the library clones via `new date.constructor(+date)` and passes nothing but the
timestamp; and the **setters must be overridden too**, because several format
tokens (`D` via `startOfYear`, `Y`/`R`/`w`/`I` via `startOfWeek`) clone the date
and write fields to it. Getters-only leaves those tokens reading display-zone
fields written in browser-local terms.

### Personal zones are opt-in, per site

An unconfigured site allows **no** personal zones: everyone reads site time, and
`resolveEffectiveTimeZone` ignores a stored personal choice rather than merely
hiding the picker. Owner decision — do not re-derive the permissive default from
"preserve what people see today" reasoning, which is what the first version
argued and what got reversed.

It is also the direction the unknowns should fail in: absent row, malformed row,
client that has not loaded its auth payload. The accepted cost is that a site
which has set neither the policy nor `TZ` shows everyone whatever zone the
server process started in.

**A panel comparing zones must re-derive its labels from the policy.** With
personal zones off the display zone IS the site zone, so a card captioned "your
time zone / from this browser" ends up attributing the site's clock to the
viewer's browser — true-looking, and wrong.

**There are exactly TWO zones, and the browser's is not one of them.** Owner
decision. System time (what stored timestamps mean) and user time (what a person
is shown) are the whole vocabulary; where the browser happens to be is an INPUT
to resolving user time, and a screen showing it presents a zone the reader
cannot act on — one that governs nothing at all under the default policy. The
words for both live in one shared client module that every clock surface renders
from, because two surfaces each inventing their own labels is how they came to
contradict each other about the same fact. An architecture-lint rule confines
the browser-zone read to the resolver plumbing plus the picker's "automatic"
row, which must say what automatic would resolve to.

**Describe provenance from the OUTCOME, not the stored value.** "You chose this
zone" is true only when the resolved zone equals the stored one: the resolver
discards a name it cannot validate and falls back, so a stale or malformed
stored zone would otherwise be captioned as a deliberate choice.

### Calendar dates are not instants

The distinction that keeps resurfacing, and the one to check first on any new
screen. A `date` column, or any `YYYY-MM-DD`, names a **day**. It has no
instant to reinterpret, and a zone can only move it onto the day before or
after. Two places it bites:

- Anything rendered for display. Render it from the Ymd string, with no `Date`
  in between.
- Anything written into a `date`/`datetime-local` input, which the browser
  parses back in the **browser's** zone. Render that in another zone and saving
  the form silently changes the stored instant while the screen looks right.

### Showing two zones at once

The redirection injects the display zone whenever a caller names none, so any
screen that COMPARES zones — a settings page, a clock in the chrome — must name
the zone in **every** format call, or all of its clocks quietly agree. The
failure renders a plausible time, throws nothing, and type-checks: the offset
between the site and the viewer simply reads as zero. `formatInTimeZone` is the
safe formatter here, and it is safe only because it always passes `timeZone`.

**Known pre-existing defect, not introduced by the display-zone work:** many
date-only columns are still rendered with `new Date(ymd).toLocaleDateString()`,
which shows the **previous day** to every viewer west of UTC. Establishing
which of those columns are `date` and which are `timestamp` is a schema-reading
job; do not guess a call site's kind from its name.
