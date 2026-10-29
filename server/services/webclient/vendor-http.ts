import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { request as httpsRequest } from "node:https";
import { hostMatches, type AllowedVendorHosts } from "./endpoint-policy";
import { WcEndpointPolicyError } from "./refusals";

export interface WcVendorHttp {
  fetch(url: string | URL, init?: RequestInit): Promise<Response>;
}

const blockedV4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedV4.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const blockedV6 = new BlockList();
// Includes Teredo, benchmarking, documentation, ORCHID and other special-use
// 2001 ranges. No mapped-IPv4 subnet in a BlockList shared with IPv4 checks.
blockedV6.addSubnet("2001::", 23, "ipv6");
blockedV6.addSubnet("2001:db8::", 32, "ipv6");
blockedV6.addSubnet("2002::", 16, "ipv6");
blockedV6.addSubnet("3fff::", 20, "ipv6");
blockedV6.addSubnet("3ffe::", 16, "ipv6");

export function isPublicVendorAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blockedV4.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !blockedV6.check(address, "ipv6");
}

export function validateVendorUrl(
  pluginId: string, input: string | URL, allowed: AllowedVendorHosts,
): URL {
  const refuse = (reason: string): never => { throw new WcEndpointPolicyError(pluginId, reason); };
  let url: URL;
  try { url = new URL(input); } catch { return refuse("invalid absolute URL"); }
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
    return refuse("only HTTPS on port 443 is permitted");
  }
  if (url.username || url.password) return refuse("URL userinfo is not permitted");
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (allowed !== undefined && !hostMatches(host, allowed)) {
    return refuse(`host '${host}' is not allowed`);
  }
  if (isIP(host) && !isPublicVendorAddress(host)) {
    return refuse(`host '${host}' is not a public address`);
  }
  return url;
}

/** The HTTPS socket's own resolver: validation and address selection are ONE
 * handoff. There is no second DNS resolution between this check and connect. */
export function publicVendorLookup(
  pluginId: string,
  resolve: (host: string) => Promise<readonly { address: string; family: number }[]> =
    (host) => dnsLookup(host, { all: true, verbatim: true }),
): LookupFunction {
  return (host, options, callback) => {
    void resolve(host).then((addresses) => {
      if (!addresses.length || addresses.some(({ address }) => !isPublicVendorAddress(address))) {
        callback(new WcEndpointPolicyError(pluginId, `host '${host}' did not resolve exclusively to public addresses`), "", 4);
        return;
      }
      if (options.all) callback(null, [...addresses]);
      else callback(null, addresses[0].address, addresses[0].family);
    }, () => callback(new WcEndpointPolicyError(pluginId, `DNS resolution failed for host '${host}'`), "", 4));
  };
}

/** Per-invocation capability. Remember refusals even if a vendor's legacy
 * catch-all turns a thrown error into an apparent successful result. */
export function createVendorHttp(
  pluginId: string,
  allowedHosts: () => AllowedVendorHosts,
): WcVendorHttp & { throwIfRefused(): void } {
  let refusal: WcEndpointPolicyError | undefined;
  const remember = (error: WcEndpointPolicyError): never => {
    refusal ??= error;
    throw error;
  };
  return {
    throwIfRefused() { if (refusal) throw refusal; },
    async fetch(input, init = {}) {
      try {
        const url = validateVendorUrl(pluginId, input, allowedHosts());
        // No caller-controlled Host header, agent, lookup, proxy, TLS settings,
        // dispatcher or redirect handling may override the checked destination.
        const headers = new Headers(init.headers);
        if (headers.has("host")) throw new WcEndpointPolicyError(pluginId, "a custom Host header is not permitted");
        const method = (init.method ?? "GET").toUpperCase();
        if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(method)) {
          throw new WcEndpointPolicyError(pluginId, "unsupported HTTP method");
        }
        const body = init.body;
        if (body !== undefined && body !== null && typeof body !== "string" &&
            !(body instanceof URLSearchParams) && !(body instanceof Uint8Array)) {
          throw new WcEndpointPolicyError(pluginId, "unsupported HTTP request body");
        }
        const signal = init.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)])
          : AbortSignal.timeout(30_000);
        return await new Promise<Response>(function executeVendorHttps(resolve, reject) {
          const req = httpsRequest(url, {
            method,
            headers: Object.fromEntries(headers),
            agent: false,
            lookup: publicVendorLookup(pluginId),
            rejectUnauthorized: true,
            signal,
          }, (res) => {
            res.on("error", reject);
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
              reject(new WcEndpointPolicyError(pluginId, `host '${url.hostname}' returned a redirect`));
              res.destroy();
              return;
            }
            const responseHeaders = new Headers();
            for (let i = 0; i < res.rawHeaders.length; i += 2) {
              responseHeaders.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
            }
            const chunks: Buffer[] = [];
            let bytes = 0;
            res.on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > 32 * 1024 * 1024) {
                res.destroy(new Error("Vendor response exceeded 32 MiB"));
              } else chunks.push(chunk);
            });
            res.on("end", () => {
              try {
                const status = res.statusCode ?? 502;
                resolve(new Response([204, 205, 304].includes(status) || method === "HEAD"
                  ? null : Buffer.concat(chunks), { status, headers: responseHeaders }));
              } catch {
                reject(new Error("Invalid vendor HTTP response"));
              }
            });
          });
          req.on("error", reject);
          req.end(body instanceof URLSearchParams ? body.toString() : body);
        });
      } catch (error) {
        if (error instanceof WcEndpointPolicyError) return remember(error);
        // Do not relay native transport errors that may include request data.
        throw new Error(`Vendor '${pluginId}' HTTPS request failed`);
      }
    },
  };
}
