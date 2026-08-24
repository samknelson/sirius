---
name: Template Studio preview pattern
description: How tokenized-text editors preview through one self-describing request, and the delivery-parity contract that keeps preview and delivery identical
---

Every tokenized-text editor previews through ONE server route, and the
**request describes itself completely**: the delivery field specs, the
finished template strings, the roots they address, and the context to
render against. No registration step, no surface id, no server-side
lookup of "who is asking". Adding a tokenized field anywhere requires
registering nothing.

**Rules learned:**
- Delivery parity and access control are separate concerns and must not
  be bundled behind one id. Shaping is a claim about the delivery path;
  who may read a record is a property of the record's kind. An
  abstraction that carries both ends up with three access models behind
  one endpoint.
- The editors must not hand-write field shaping: both delivery and the
  editors import the SAME field tables (`shared/delivery-fields.ts`), so
  a preview cannot claim a shaping delivery does not perform. The route
  still validates the posted specs (known media, unique keys,
  `blankWithout` resolvable) because the body is untrusted.
- Declaring a field's shaping is a *claim about the delivery path*, and the claim is usually wrong the first time. Before declaring one, read what delivery actually does to that exact field — including whether it renders tokens at all. Fields whose editor offers no token insertion are delivered verbatim and must preview verbatim; a field can be tokenized on one channel and literal on another.
  **How to apply:** when preview and delivery disagree, fix delivery to match the shaping the editor implies (that is what the author expects), and route both paths through ONE shared function so they cannot drift again.
- Shaping is more than "what kind of content is this": whitespace trimming, blank-value fallbacks and "this channel sends nothing when a required field is empty" are delivery behaviour too, and a preview that ignores them lies in ordinary cases (padded text, a padded-but-valid link, a whitespace-only title). Declare them per field alongside the media, and have delivery read the same declarations.
- Caller-specific template composition (a notifier's default-vs-override
  merge, a rich-text body flattened to plain text) belongs in the
  CALLER, which posts finished strings. A preview endpoint that knows
  about its callers is a surface registry growing back.
- Guard parity with a test that renders through the preview pipeline and the delivery function and compares, using content the shaping really changes **and** ordinary content it must leave alone — otherwise "no shaping at all" and "over-sanitizing" both pass vacuously. Substituting a real token value matters: unknown tokens render identically on both sides and hide a missing render step.
- A field whose value blanks out can suppress a companion field (an in-app link label follows its link URL). Express that on the field spec so every caller inherits it, and assert both paths drop the pair together.
- A caller only needs its own client host when it has *editor-side* logic (e.g. default-vs-override text). Previewing never justifies a host. A host that hides optional rows must still post templates for EVERY delivery field of the channel, or the deliverable decision is wrong.
- Token catalog endpoints are gated differently from preview (generic catalog is admin, the bulk catalog is bulk-permission), so the catalog URL must stay per-caller overridable even though preview is plain staff.
- Event-scoped token catalogs: the event root and per-kind relation plugins are hidden from the catalog, so the event-root walk must use the FULL registry, not the visible subset.
- Real-record preview is a property of an **entity kind**, never of an editor: the kind's token plugin declares its own gate and loader, and every editor rooted at that kind inherits it.
- The eval context seeds a **bag of roots keyed by root name** (plus the recipient contact), and sample-vs-real is decided per root at the chain's root segment: an unseeded root samples, a seeded one resolves real, so one render honestly mixes both.
  **Why:** a single global "sample" flag made real preview all-or-nothing and reachable only by relation-walking from contact-or-event.
  **How to apply:** delivery never enables sample fallback, so per-root logic must live behind that flag or delivery starts rendering examples. A root that needs no record (system values) must follow the render instead of always sampling.
- A delivery-parity check must seed the very root delivery composes with; otherwise the unseeded root samples and parity fails for a behavior that is correct.
- The studio's right-hand column is a single-open disclosure (preview / seed pickers / token browser), hand-rolled rather than the shared Radix accordion.
  **Why:** the open section has to FILL the dialog's remaining height, and Radix animates content height and unmounts the closed sections — unmounting throws away where the author had browsed to in the token tree and re-runs the preview on every toggle.
  **How to apply:** don't "clean this up" by swapping in the shared accordion. Closed sections stay mounted behind `hidden`; the open one is the flex child that grows and scrolls internally.
- The list of roots a preview offers is DECLARED by the container, complete and ordered; nothing is added implicitly, and the client posts back the very roots its panel is showing.
  **Why:** implicit "ordinary" roots made author order an accident of plugin registration, and let a notifier author seed a worker independently of the recipient contact — a pairing delivery can never produce, because on delivery worker/employer resolve FROM the recipient.
  **How to apply:** a surface about a record names its roots in author order and adds only the recipient; a surface about the recipient asks for the ordinary roots by name. Seeding is gated by that same list, so a root left off cannot be seeded — while tokens rooted there still render from the recipient or samples, exactly as delivery does.
