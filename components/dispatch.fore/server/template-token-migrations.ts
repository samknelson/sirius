import { registerNotifierTemplateRewrite } from "../../../server/plugins/event-notifier/template-token-migrations";
registerNotifierTemplateRewrite({
  pluginId: "dispatch-fore-notifier",
  rewriteChain(segments) {
    const [root, next, ...rest] = segments;
    if (root.name !== "dispatch_fore") return null;
    if (next?.name === "dispatch_job") return [{ name: "dispatch_job", args: next.args }, ...rest];
    if (next?.name === "field") {
      const name = next.args.name === "job_title" ? "title" : next.args.name === "employer_name" ? "employer_id" : null;
      if (name) return [{ name: "dispatch_job", args: root.args }, { ...next, args: { ...next.args, name } }, ...rest];
    }
    return null;
  },
});
