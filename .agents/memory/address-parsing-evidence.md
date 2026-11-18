---
name: Address parsing evidence
description: Safely preserving units when a vendor returns only building-level address components.
---

Do not preserve a unit by replacing a vendor's parsed street with an ambiguous
locally parsed raw address, or by trusting the number of comma-separated segments.

**Why:** a single unpunctuated input can leave city/state in the local street,
while a separately delimited state and ZIP can shift the city into an inferred
second line. Both errors look valid after a vendor supplies the other fields.

**How to apply:** identify locality suffixes before extracting extra street
lines; augment vendor answers only with explicit unit evidence or locally
parsed lines whose locality agrees independently. Include cases with city,
state and ZIP on separate lines, with and without an actual apartment.
