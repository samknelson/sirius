import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { assertExternalServiceAllowed } from "../../services/maintenance-flag";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

// Deny everything outside globally routable unicast space, plus special-use
// addresses within it. Check EVERY DNS answer and pin the approved address
// for the actual connection so a second lookup cannot switch the destination.
const blocked = new BlockList();
for (const [network, mask] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as Array<[string, number]>) blocked.addSubnet(network, mask, "ipv4");
for (const [network, mask] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96],
  ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7],
  ["fe80::", 10], ["ff00::", 8],
] as Array<[string, number]>) blocked.addSubnet(network, mask, "ipv6");

export function isSafeRemoteAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family === 6) return address.includes(":")
    && !blocked.check(address, "ipv6")
    && /^(2|3)[0-9a-f]{3}:/i.test(address); // 2000::/3, globally routable unicast
  return false;
}

export async function resolveRemoteTarget(
  url: URL,
  resolve = lookup,
): Promise<{ address: string; family: 4 | 6 }> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname.endsWith(".") || hostname.toLowerCase() === "localhost") {
    throw new Error("Private or local targets are not allowed");
  }
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolve(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isSafeRemoteAddress(address))) {
    throw new Error("Private or local targets are not allowed");
  }
  return addresses[0] as { address: string; family: 4 | 6 };
}

export interface WsTestHttpResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: unknown;
}

export async function executeWsTestHttp(
  target: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  local: boolean,
): Promise<WsTestHttpResult> {
  assertExternalServiceAllowed("Web service test", "execute request");
  const url = new URL(target);
  const address = local ? null : await resolveRemoteTarget(url);
  return new Promise((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(url, {
      method,
      headers,
      agent: false,
      timeout: REQUEST_TIMEOUT_MS,
      ...(address ? {
        lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      } : {}),
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy(new Error("Response is too large (1 MB limit)"));
        } else {
          chunks.push(chunk);
        }
      });
      response.on("error", reject);
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data: unknown = text;
        try { data = JSON.parse(text); } catch { /* Non-JSON responses stay text. */ }
        const safeHeaders = Object.fromEntries(
          Object.entries(response.headers)
            .filter(([key]) => !/^(set-cookie|authorization|proxy-authorization|x-ws-client-)/i.test(key))
            .map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value ?? ""]),
        );
        resolve({
          status: response.statusCode ?? 0,
          statusText: response.statusMessage ?? "",
          headers: safeHeaders,
          data,
        });
      });
    });
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    req.end(body);
  });
}