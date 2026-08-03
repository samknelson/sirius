import { registerSystemStatusPlugin } from "../registry";
import { storage } from "../../../../storage";
import { getPublicBaseUrl } from "../../../../services/comm/callback-handlers/url-builder";

registerSystemStatusPlugin({
  id: "instance",
  name: "Instance",
  description: "Basic information about this instance: site name and public URL.",
  // Thin wrapper over existing lookups — cheap, always informational, no
  // point caching or offering a rescan button.
  scanMode: "immediate",
  async scan() {
    const siteNameVar = await storage.variables.getByName("site_name");
    const siteName =
      siteNameVar && typeof siteNameVar.value === "string" && siteNameVar.value.trim() !== ""
        ? siteNameVar.value
        : undefined;
    const url = getPublicBaseUrl();
    return [
      {
        priority: "info" as const,
        title: `Site name: ${siteName ?? "not set"}`,
        details: siteName ? undefined : 'The "site_name" variable is not set.',
      },
      {
        priority: "info" as const,
        title: `URL: ${url ?? "not available"}`,
        details: url
          ? undefined
          : "No public URL is configured (REPLIT_DEV_DOMAIN, REPLIT_DEPLOYMENT_DOMAIN, and PUBLIC_URL are all unset).",
      },
    ];
  },
});
