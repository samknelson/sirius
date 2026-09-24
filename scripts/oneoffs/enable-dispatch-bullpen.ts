import { enableComponentSchema } from "../../server/services/component-lifecycle";
import { updateComponentCache } from "../../server/services/component-cache";

async function main() {
  const result = await enableComponentSchema("dispatch.bullpen");
  console.log("enableComponentSchema:", JSON.stringify(result, null, 2));
  if (!result.success) {
    process.exit(1);
  }
  await updateComponentCache("dispatch.bullpen", true);
  console.log("Component dispatch.bullpen enabled");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
