---
name: Generated API document addressing
description: Why a published URL address must be computed as the exact inverse of the request-time resolver, and where that pair lives.
---

A generated API/OpenAPI document publishes an address for each service; the
dispatcher turns an address back into a service. Those are two directions of
ONE mapping, and the publishing side must be the inverse of the resolving side
— not "the prettiest name available".

**Why:** web service configuration aliases are not unique at save time, and
resolution tries the configuration id BEFORE the alias. So naively preferring
an alias publishes (a) an alias shared by two configurations, which the
resolver refuses outright, and (b) an alias spelled the same as another
configuration's id, which routes to that other service. Both produce a document
that reads well and does not work — and the second names one service at another
service's address. Prettiness loses to reachability: fall back to the id, and
say in the document why the address is environment-specific.

**How to apply:** keep the resolver and the address chooser in the same leaf
module (`server/modules/webservices/addressing.ts`) and have the dispatcher
import the resolver from there rather than owning a private copy. Test the
property, not the rule: build a document over a deliberately nasty
configuration set (duplicate aliases, an alias equal to another id, no alias)
and assert that feeding every published address back through the real resolver
returns exactly the intended set of services.

The same reasoning applies to any other "publish an address / resolve an
address" pair, including public config aliases.
