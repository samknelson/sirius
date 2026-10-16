---
name: Historical coverage evidence
description: Rules for interpreting old BAO coverage periods when present-day relationships have changed
---

For historical BAO coverage reads, never use today's home employer or today's EE charge configuration as the sole authority for earlier months. If the month has no election, use employer evidence from its source work month; retain posted EE charges on accounts formerly used by a charge configuration.

**Why:** Both the worker's home employer and a charge configuration's account can change while historic work and posted charges remain on the original employer/account. Present-day lookup would rewrite the meaning of old months or erase posted charges.

**How to apply:** In read models covering past periods, identify the historical employer from that period's election or work records and discover EE accounts from posted plugin entries in addition to current configuration. Keep months with insufficient evidence explicitly unknown rather than interpreting missing rows as negative decisions.

Covered dependents in monthly Summary history are reverse, subscriber-provided coverage, not benefits the subscriber received. Preserve status-only spans, including when the subscriber has no own benefit. Do not reconstruct missing historical subscriber links from current elections or invent historical identity snapshots.

**Why:** Staff need the actual recipients for each period; the user explicitly excluded reconstruction of lost historical links. Retained display metadata does not prove what a person's name or relationship label was at the time.

**How to apply:** Keep monthly detail authoritative, qualify retained identity labels, and treat immutable historical identity/source retention as separately approved future work rather than silently adding it to a read-only history feature.

On Benefits Summary only, list dependent names and retained relationship labels, without dependent-specific dates, ranges or benefits. Deduplicate each person across the loaded span, but use only that month's evidence for the selected-month list. Do not change the separate Benefit History screen or infer dependent benefits.

**Why:** The user clarified that the summary should be a simple recipient list, not individual coverage-range or benefit detail.

**How to apply:** Keep subscriber benefits intact and distinguish empty, unavailable, and incomplete dependent lists.

Only positively verified imported history can use the previous-system Inactive explanation. Missing records, hours-only history, and dates before the first local scan are not a third inferred source of coverage decisions. Pending scans and read failures must keep their own explanations.

**Why:** The user explicitly limited the previous-system treatment to imports, not all formerly unconfirmed months; accepted imports with reviewed rejects do not establish complete negative source evidence.

**How to apply:** Fail explicitly unavailable when import ownership or completeness cannot be established; never use missing positive rows as negative evidence when retained source spans still assert positive coverage.