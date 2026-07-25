import { enableComponentSchema, reconcileComponentPluginConfigs } from "../../server/services/component-lifecycle";
import { updateComponentCache } from "../../server/services/component-cache";

async function main() {
  const result = await enableComponentSchema("dispatch.department");
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exit(1);
  await reconcileComponentPluginConfigs("dispatch.department", true);
  await updateComponentCache("dispatch.department", true);
  console.log("dispatch.department enabled");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
