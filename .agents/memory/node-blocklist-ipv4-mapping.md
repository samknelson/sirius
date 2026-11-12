---
name: Node BlockList IPv4 mapping
description: IPv4-mapped IPv6 subnet rules can unexpectedly match plain IPv4 checks in Node's net.BlockList.
---

When using Node's `net.BlockList`, adding `::ffff:0:0/96` as an IPv6 blocked subnet also makes `blockList.check("99.86.101.78", "ipv4")` return true. It does not behave as an independent IPv6-only rule: Node maps ordinary IPv4 addresses into the mapped IPv6 range for matching.

**Why:** An outbound public-address gate rejected all DNS answers for a publicly routed host even though each answer was ordinary public IPv4. Isolating the block rules identified the mapped-IPv4 subnet as the culprit.

**How to apply:** If adding a future outbound IP gate, explicitly test public IPv4 examples against the full combined block list, not just against its IPv4 subnet rules. Avoid blocking the entire mapped-IPv4 range when separately checking IPv4 for public reachability.