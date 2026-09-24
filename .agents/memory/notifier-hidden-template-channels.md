---
name: Notifier hidden template channels
description: How undeliverable notifier template medium cards are hidden without wiping stored overrides
---
Undeliverable template medium cards (channel not in the plugin's supportedMedia, or no site provider for the channel) are hidden by marking the channel group `x-token-hidden: true` on a CLONE of the schema at manifest decorateEntries time; the client field renders null for the marker.

**Why:** RJSF strips any stored data whose field isn't declared in the schema — removing the group from the served schema would wipe an existing override for the hidden medium on the next save. Validation still runs against the unmodified registered schema.

**How to apply:** never prune template channel groups from the served schema; add markers instead, and never mutate the registered impl.configSchema (it's shared/static). Site channel availability comes from getSiteEnabledTemplateChannels (provider checks fail open).
