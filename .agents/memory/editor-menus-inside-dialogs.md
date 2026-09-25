---
name: Editor menus inside dialogs
description: Escape handling for custom Template Studio menus inside Radix dialogs.
---

When a custom editor menu is open inside a Radix dialog, prevent the dialog's own Escape dismissal explicitly; stopping React propagation in the menu alone may not prevent the outer dismissable layer from closing.

**Why:** The selection menu's Escape handler closed its menu, but the dialog still disappeared in a real browser test until its dismiss handler also prevented the event.

**How to apply:** For new custom menus in Studio dialogs, test Escape in the real dialog, and make the dialog's escape handler conditional on the active inner menu instead of blocking all dialog Escape keys.