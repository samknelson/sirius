---
name: RJSF v6 formData prop sync after mount
description: Custom ui:field components don't pick up formData prop changes made after the form mounts; remount the form after seeding.
---

RJSF v6 does not reliably re-sync custom `ui:field` components when the `formData` prop changes after the form has mounted. If a dialog seeds its settings state in a `useEffect` after the RJSF form mounted with empty data, saved values never reach custom fields (checkboxes render unchecked even though the network response has the data).

**Why:** Hit on the generic plugin-config edit dialog — saved recipient selections persisted fine but showed empty on reopen; the fault was purely mount/seed ordering vs. RJSF's post-mount formData handling.

**How to apply:** After seeding form state from fetched/config data, bump a `key` on the form component so it remounts and initializes from the seeded values (or defer mounting until seeded). Ensure the seeding effect's deps are referentially stable, or the key bump loops and wipes in-progress edits.
