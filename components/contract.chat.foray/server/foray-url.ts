import { WcVendorError } from "../../../server/plugins/wc-vendors/errors";

export const forayDefaultUrl = "https://cba-service.foray-consulting.workers.dev";
export function forayBaseUrl(value: unknown): string {
  const input = value === undefined ? forayDefaultUrl : value;
  try {
    if (typeof input !== "string") throw new Error();
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      (url.port && url.port !== "443")) throw new Error();
    return url.href.replace(/\/+$/, "");
  } catch {
    throw new WcVendorError(400, "Foray requires an HTTPS base URL on port 443, without credentials, query or fragment.");
  }
}
