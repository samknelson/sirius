import { registerNotifierTemplateRewrite, withArg } from "../../../server/plugins/event-notifier/template-token-migrations";

// Boot-time rewrite of customised templates written against the old token roots.
registerNotifierTemplateRewrite({
  pluginId: "grievance-status-notifier",
  rewriteChain(segments) {
    const [root, next, ...rest] = segments;
    if (root.name !== "grievance_status") return null;

    // The grievance is now a root of its own, not a hop off the entry.
    if (next?.name === "grievance") {
      return [{ name: "grievance", args: next.args }, ...rest];
    }
    if (next?.name === "field") {
      const field = next.args.name;
      // `grievance_title` was a value flattened onto the status entry; the
      // grievance's own display title is the real home for it.
      if (field === "grievance_title") {
        return [
          { name: "grievance", args: root.args },
          withArg(next, "name", "display_title"),
          ...rest,
        ];
      }
      // `status_name` was flattened too; the entry's status FK renders the
      // status option's name on its own.
      if (field === "status_name") {
        return [
          { name: "grievance_status_history", args: root.args },
          withArg(next, "name", "status_id"),
          ...rest,
        ];
      }
    }
    // Everything else keeps its chain, under the root's real name.
    return [
      { name: "grievance_status_history", args: root.args },
      ...(next ? [next] : []),
      ...rest,
    ];
  },
});
