---
name: DP report billing authority
description: How current-month posted DP billing and reconstructive coverage pricing are ordered for reporting.
---
A surviving posted Domestic Partner charge is authoritative for that exact billing month, including its FIFO-applied payment status, even if the separate WMB/rate lookup can no longer reconstruct the price.

**Why:** Billing is the durable result of the month’s charge run. Treating a later reconstructive lookup as stronger can report a paid partner as unavailable and erase real charge/payment totals.

**How to apply:** Match billing by election, DP relationship, and exact month. Use only a positive surviving net charge as the override, but separately warn staff when current reconstruction is unavailable or differs from that net charge. Historical charges, fully reversed charges, and absent current-month charges neither establish current coverage nor trigger drift warnings; use the fail-closed pricing result for those cases.