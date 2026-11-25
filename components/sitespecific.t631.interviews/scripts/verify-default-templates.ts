/**
 * Read-only verifier for configuration-dependent notifier defaults.
 * Run with tsx; does not create fixtures, send messages, or read credentials.
 */
import { initializeTokenPluginSystem, validateTokenExpressionForRoots } from "../../../server/plugins/tokens";
import { sitespecificT631InterviewNotifier } from "../server/plugins/event-notifier/plugins/sitespecific-t631-interview";

initializeTokenPluginSystem();
const tokens = sitespecificT631InterviewNotifier.tokenTemplates!;
const roots = tokens.roots.map(root => root.name);
let checked = 0;
for (const recipientKind of ["worker", "employer", "staff"]) {
  const templates = tokens.defaultTemplates!({ recipientKind });
  for (const [channel, fields] of Object.entries(templates)) {
    for (const [field, template] of Object.entries(fields ?? {})) {
      if (typeof template !== "string") continue;
      for (const match of template.matchAll(/\{\{([^}]+)\}\}/g)) {
        const result = validateTokenExpressionForRoots(match[1].trim(), roots);
        if (!result.ok) throw new Error(`${recipientKind} ${channel}.${field}: ${result.error}`);
        checked++;
      }
    }
  }
}
console.log(`Validated ${checked} default-template expressions across all three recipient variants.`);
