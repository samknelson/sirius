import { registerNotifierTemplateRewrite, withArg } from "../../../server/plugins/event-notifier/template-token-migrations";

// Boot-time rewrite of customised templates written against the old token roots.
registerNotifierTemplateRewrite({
  pluginId: "grievance-settlement",
  rewriteChain(segments) {
    const [root, next, ...rest] = segments;
    if (root.name !== "grievance_settlement") return null;

    // The grievance is now a root of its own, not a hop off the settlement.
    if (next?.name === "grievance") {
      return [{ name: "grievance", args: next.args }, ...rest];
    }
    // `grievance_title` was a value flattened onto the settlement; the
    // grievance's own display title is the real home for it.
    if (next?.name === "field" && next.args.name === "grievance_title") {
      return [
        { name: "grievance", args: root.args },
        withArg(next, "name", "display_title"),
        ...rest,
      ];
    }
    return null;
  },
});
