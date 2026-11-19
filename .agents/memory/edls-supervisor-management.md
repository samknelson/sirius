---
name: Supervisor sheet management
description: Place supervisor status actions on the existing Manage tab
---
Supervisors should use the sheet's existing Manage tab, with each action shown according to its own authorization. Do not add a separate scheduling-request button to Details.

**Why:** The user explicitly rejected the separate Details action and requested the Manage tab instead. Visibility of the tab must not grant broader management capabilities.

**How to apply:** Keep supervisor draft-to-Requested actions in Manage; use the same action-specific policies for controls and their write endpoints.

Supervisors must also be able to copy their assigned sheets from Manage, including scheduled source sheets. A copy creates a new draft; this does not authorize broader source-sheet management.

**Why:** The user explicitly requested supervisor copying after reviewing the restricted Manage tab.
