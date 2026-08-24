import { enableComponentSchema } from "../../server/services/component-lifecycle";
import { updateComponentCache } from "../../server/services/component-cache";
import "../migrate/components/sitespecific.t631.interviews/001_create_job_interviews";

async function main() {
  const result = await enableComponentSchema("sitespecific.t631.interviews");
  console.log("enableComponentSchema:", JSON.stringify(result, null, 2));
  if (!result.success) {
    process.exit(1);
  }
  await updateComponentCache("sitespecific.t631.interviews", true);
  console.log("Component sitespecific.t631.interviews enabled");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
