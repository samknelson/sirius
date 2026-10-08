---
name: Template Studio topics
description: Index of related editor, context, preview authorization, and token-root conventions.
---

- [Template Studio host pattern](template-studio-host-pattern.md) — preview is self-describing; callers compose templates; shared field tables keep preview and delivery aligned.
- [Template preview subjects](template-preview-subjects.md) — entity references are gated per token kind; the same id is checked and loaded; persona keys belong to the kind owning the leaf.
- [Real-record preview gating](preview-record-gating.md) — kinds must declare a record policy or route gate; offering records does not authorize rendering them.
- [Token editing invariants](token-editing-invariants.md) — Studio is the only token-string editor; evaluation is medium-independent and cleaning belongs to the container.
- [Token contexts](token-context-catalog.md) — a launch names one context; roots come from the shared catalog.
- [Declared roots](studio-root-declaration.md) — scope the segment graph, not just the picker.
- [Supplied records](studio-record-supply.md) — containers supply records by root; the framework does not find them.
- [Event replay seeds](studio-seeds-from-event-replay.md) — seed real event examples through replay.
- [Send-scoped roots](send-scoped-token-roots.md) — gate roots on the recipient.
- [Host data honesty](studio-host-source-state.md) — expose loading/error state and say whose records are offered.
- [Default leaf per producer](token-default-leaf-per-producer.md) — every producer declares the kind's default leaf, including hop-only producers.
- [Editor catalog contract](editor-catalog-config-contract.md) — send the whole unsaved config, debounced; lists of dependent fields silently go stale.
- [Component gating](token-component-gating-offer-only.md) — gating narrows the offer, not the saved vocabulary.
- [Manual compose render](manual-compose-render-step.md) — refuse text that still contains unevaluated tokens.
- [Argument choices](token-arg-choices-freeze.md) — choices freeze at registration; runtime-minted ids remain free text.
- [Entity location](entity-location-declaration.md) — declare page and id field, not a route.
- [Template library route](studio-template-library-route.md) — reuse staff CRUD with medium/context filters; 401/403 hides Templates, never create a parallel Studio library route.
