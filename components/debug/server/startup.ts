import type { ComponentStartup } from "../../../server/services/component/startup-types";
import { alterHooks } from "@shared/alter";
import { logCleanupDefaultsHook } from "../../../server/plugins/system/cron/log-cleanup-defaults";
import { echpDateHook } from "../../../server/modules/sitespecific/bao/echp-date";
import { getEffectiveUser } from "../../../server/modules/masquerade";
import { storage } from "../../../server/storage";
import { registerSamlCapture } from "./saml";
import { registerEventBusIntrospectRoutes } from "./modules/event-bus-introspect";
import { registerSqlRoutes } from "./modules/eligible-workers-sql";

export function register(): void {
  registerSamlCapture();
  alterHooks.registerSync(logCleanupDefaultsHook, {
    id: "debug.log-cleanup.default", component: "debug", priority: 10, metadata: {},
    description: "Suggest disabled seven-day SAML capture cleanup",
    alter: policies => [...policies, { module: "saml_debug", operation: null, retentionDays: 7, enabled: false }],
  });
  alterHooks.register(echpDateHook, {
    id: "debug.echp.date", component: "debug", priority: 10, metadata: {},
    description: "Allow effective administrators to evaluate ECHP at a supplied date",
    async alter(previous, { request: req }) {
      const raw = typeof req.query.asOf === "string" ? req.query.asOf : "";
      const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
      if (!parsed) return previous;
      const [year, month, day] = parsed.slice(1).map(Number);
      if (month < 1 || month > 12 || day < 1 || day > 31) return previous;
      const { dbUser } = await getEffectiveUser(req.session, req.user);
      if (!dbUser || !await storage.users.userHasPermission(dbUser.id, "admin")) return previous;
      return { asOf: { year, month, day }, asOfApplied: true };
    },
  });
}
export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> = app => {
  registerEventBusIntrospectRoutes(app);
  registerSqlRoutes(app);
};
