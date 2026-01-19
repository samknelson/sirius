import { registerCronSettingsComponent } from "@/lib/cron-settings-registry";
import { LogCleanupPolicies } from "./LogCleanupPolicies";

registerCronSettingsComponent("logCleanupPolicies", LogCleanupPolicies);

export { LogCleanupPolicies };
