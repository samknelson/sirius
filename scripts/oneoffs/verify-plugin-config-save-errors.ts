/**
 * One-off e2e check: a rejected plugin-config save must tell the author what
 * is actually wrong, and the config metadata must narrow an event notifier's
 * media to what that notifier can send.
 *
 * Exercises the real generic routes:
 *   1. GET  /api/plugins/event-notifier/configs/meta
 *      -> pluginEnvelopeFields[<notifier>] locks the unsupported media with a
 *         reason, while the kind-level envelopeFields (used by the filter bar)
 *         still offers every medium.
 *   2. POST /api/plugins/event-notifier/configs with an unsupported medium
 *      -> 400 whose `message` names the unsupported medium (not the old
 *         generic "Invalid plugin configuration") and whose `errors` carries
 *         every reason.
 *   3. POST with a malformed envelope
 *      -> 400 whose `errors` are readable "field — problem" lines rather than
 *         raw Zod issue objects.
 *
 * Run: npx tsx scripts/oneoffs/verify-plugin-config-save-errors.ts
 */
import express from "express";
import { storage } from "../../server/storage";
import { loadComponentCache, isComponentEnabledSync } from "../../server/services/component-cache";
import { initAccessControl } from "../../server/services/access-policy-evaluator";
import { initializePermissions } from "../../shared/permissions";
import "../../shared/access-policies/loader";
import { registerPluginsConfigRoutes } from "../../server/modules/system/plugins-config";
import { initializeEventNotifierPluginSystem } from "../../server/plugins/event-notifier";

const KIND = "event-notifier";
// A notifier that does NOT support postal (see its supportedMedia).
const PLUGIN_ID = "grievance-status-notifier";

async function main() {
  await loadComponentCache();
  initializePermissions();
  initAccessControl(
    {
      getUserPermissions: async (userId: string) => {
        const permissions = await storage.users.getUserPermissions(userId);
        return permissions.map((p) => p.key);
      },
      hasPermission: async (userId: string, permissionKey: string) =>
        storage.users.userHasPermission(userId, permissionKey),
      getUser: async (userId: string) => storage.users.getUser(userId),
    },
    storage,
    async (componentId: string) => isComponentEnabledSync(componentId),
  );
  initializeEventNotifierPluginSystem();

  const allUsers = await storage.users.getAllUsers();
  let adminUser: any = null;
  for (const u of allUsers) {
    if (await storage.users.userHasPermission(u.id, "admin")) {
      adminUser = u;
      break;
    }
  }
  if (!adminUser) {
    console.error("FAIL: no admin user in dev DB; cannot verify");
    process.exit(1);
  }

  const app = express();
  app.use(express.json());
  const fakeAuth = (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: adminUser.id }, dbUser: adminUser };
    req.isAuthenticated = () => true;
    next();
  };
  registerPluginsConfigRoutes(app, fakeAuth);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  let failures = 0;
  const check = (label: string, ok: boolean, detail?: unknown) => {
    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${label}` +
        (ok || detail === undefined ? "" : ` :: ${JSON.stringify(detail)}`),
    );
  };

  try {
    // 1. metadata narrowing
    const metaRes = await fetch(`${base}/api/plugins/${KIND}/configs/meta`);
    const meta: any = await metaRes.json();
    const kindMedia = (meta.envelopeFields ?? []).find((f: any) => f.name === "media");
    const pluginMedia = (meta.pluginEnvelopeFields?.[PLUGIN_ID] ?? []).find(
      (f: any) => f.name === "media",
    );
    check(
      "kind-level media still offers every medium (filter bar spans all plugins)",
      (kindMedia?.options?.choices ?? []).every((c: any) => !c.disabled),
      kindMedia?.options?.choices,
    );
    const postal = (pluginMedia?.options?.choices ?? []).find((c: any) => c.value === "postal");
    check(
      "per-plugin media locks postal with a reason",
      postal?.disabled === true && typeof postal?.disabledReason === "string",
      postal,
    );
    check(
      "per-plugin media leaves supported media selectable",
      ["email", "sms", "inapp"].every((m) =>
        (pluginMedia?.options?.choices ?? []).some((c: any) => c.value === m && !c.disabled),
      ),
      pluginMedia?.options?.choices,
    );

    // 2. plugin-level rejection (unsupported medium)
    const badMediaRes = await fetch(`${base}/api/plugins/${KIND}/configs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pluginId: PLUGIN_ID,
        name: "verify-unsupported-media",
        enabled: true,
        media: ["inapp", "postal"],
        data: {},
      }),
    });
    const badMedia: any = await badMediaRes.json();
    check("unsupported medium is rejected with 400", badMediaRes.status === 400, badMedia);
    check(
      "rejection message names the unsupported medium",
      typeof badMedia.message === "string" && badMedia.message.includes("postal"),
      badMedia.message,
    );
    check(
      "rejection keeps the full reason list",
      Array.isArray(badMedia.errors) &&
        badMedia.errors.length > 0 &&
        badMedia.errors.every((e: unknown) => typeof e === "string"),
      badMedia.errors,
    );

    // 3. envelope (schema) rejection
    const badEnvelopeRes = await fetch(`${base}/api/plugins/${KIND}/configs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: 42, enabled: true, data: {} }),
    });
    const badEnvelope: any = await badEnvelopeRes.json();
    check("malformed envelope is rejected with 400", badEnvelopeRes.status === 400, badEnvelope);
    check(
      "envelope errors are readable strings, not raw Zod issues",
      Array.isArray(badEnvelope.errors) &&
        badEnvelope.errors.length > 0 &&
        badEnvelope.errors.every((e: unknown) => typeof e === "string"),
      badEnvelope.errors,
    );
    check(
      "envelope message names the offending field",
      typeof badEnvelope.message === "string" &&
        badEnvelope.errors?.some((e: string) => badEnvelope.message.includes(e)),
      badEnvelope.message,
    );
  } finally {
    server.close();
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
