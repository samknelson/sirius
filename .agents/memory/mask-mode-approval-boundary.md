---
name: Mask Mode scope and approval boundary
description: User requirements for recording mode and the distinction between an audit and implementation approval.
---

The user selected **strict live-data de-identification**, with **admin** as the only role permitted to toggle. This supersedes the earlier convenience policy that kept first names and last-four fragments. Neither those fragments nor initials qualify under Safe Harbor. Legacy AAT and unclassified identifiers remain withheld; CSS or client-only formatting is insufficient.

**Why:** The user records training against live S2 data, required an audit-first approval boundary, and subsequently broadened the objective to HIPAA-informed protection. HHS explicitly rejects last-four SSNs and initials under Safe Harbor; a masking feature cannot certify the whole workflow.

**How to apply:** Do not silently replace live data with fictional people or re-enable convenience fragments. The strict approach deliberately refuses original/unknown surfaces rather than assuming their complex output is safe; expanding it requires a positive reviewed disclosure contract. Do not substitute development configuration for live evidence. Preserve public-link, prior-browser-content and sleeping-tab limitations, and never claim whole-workflow HIPAA compliance or an Expert Determination from UI or test results alone.
