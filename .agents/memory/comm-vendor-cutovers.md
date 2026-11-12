---
name: Comm vendor cutovers
description: Durable migration and capability rules for moving communication providers into wc-vendors.
---

Local communication plugins must omit delivery operations they cannot perform. They may expose local validation or diagnostics, but must never return simulated delivery success that Comm could persist as sent.

**Why:** A credential-free Local fallback can become selected during an upgrade; a successful delivery stub then silently records an email, SMS, or letter as sent when nothing left the application.

**How to apply:** Capability is operation presence. Do not stub unsupported sends, status polling, or cancellation. Comm must treat an absent operation as unavailable.

Legacy provider migration must preserve explicit stored selections first, then effective environment configuration—including database-backed environment overrides—before choosing Local. Persist only the registered secret name, never its value.

**Why:** Older installations may be configured entirely through deployment variables or in-app environment overrides, with no provider-settings row. Looking only at raw process variables silently disables a working remote provider.

**How to apply:** Serialize migration and provider switching, preserve exact legacy non-secret field names, check effective registered credential presence without logging or storing the value, reject ambiguity, and address the selected config by ID.