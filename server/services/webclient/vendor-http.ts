import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { request as httpsRequest } from "node:https";
import { hostMatches, type AllowedVendorHosts } from "./endpoint-policy";
import { WcEndpointPolicyError } from "./refusals";

export interface WcVendorHttp {
  fetch(url: string | URL, init?: RequestInit): Promise<Response>;
}

const blockedV4 = [
  ["0.0.0.0", 8, "unspecified/this-network"], ["10.0.0.0", 8, "private"],
  ["100.64.0.0", 10, "shared/CGNAT"], ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link-local/metadata"], ["172.16.0.0", 12, "private"],
  ["192.0.0.0", 24, "special-use"], ["192.0.2.0", 24, "documentation"],
  ["192.88.99.0", 24, "deprecated relay"], ["192.168.0.0", 16, "private"],
  ["198.18.0.0", 15, "benchmarking"], ["198.51.100.0", 24, "documentation"],
  ["203.0.113.0", 24, "documentation"], ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "reserved/broadcast"],
] as const;
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
// Includes Teredo, benchmarking, documentation, ORCHID and other special-use
// 2001 ranges. No mapped-IPv4 subnet in a BlockList shared with IPv4 checks.
const blockedV6 = [
  ["2001::", 23, "special-use"], ["2001:db8::", 32, "documentation"],
  ["2002::", 16, "6to4"], ["3fff::", 20, "documentation"],
  ["3ffe::", 16, "retired 6bone"],
] as const;
function addressRules(ranges: readonly (readonly [string, number, string])[], family: "ipv4" | "ipv6") {
  return ranges.map(([address, prefix, reason]) => {
    const block = new BlockList();
    block.addSubnet(address, prefix, family);
    return { block, reason: `${reason} (${address}/${prefix})` };
  });
}
const v4Rules = addressRules(blockedV4, "ipv4");
const v6Rules = addressRules(blockedV6, "ipv6");
const mappedV6 = new BlockList();
mappedV6.addSubnet("::ffff:0:0", 96, "ipv6");

function vendorAddressRejection(address: string): string | undefined {
  const family = isIP(address);
  if (family === 4) return v4Rules.find(({ block }) => block.check(address, "ipv4"))?.reason;
  if (family !== 6) return "invalid IP address";
  // Never check ordinary IPv4 against this list: Node maps it into this subnet.
  if (mappedV6.check(address, "ipv6")) return "IPv4-mapped IPv6";
  if (!globalV6.check(address, "ipv6")) return "outside global IPv6 unicast (2000::/3)";
  return v6Rules.find(({ block }) => block.check(address, "ipv6"))?.reason;
}

export function isPublicVendorAddress(address: string): boolean {
  return vendorAddressRejection(address) === undefined;
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
      let rejected = 0;
      const details: string[] = [];
      for (const { address } of addresses) {
        const reason = vendorAddressRejection(address);
        if (reason === undefined) continue;
        rejected++;
        // Log only valid IP literals, never arbitrary resolver/error content.
        // Bound both the number and size of answers included in a refusal.
        if (details.length < 8) details.push(`${isIP(address) ? address.split("%", 1)[0].slice(0, 64) : "[invalid address]"}: ${reason}`);
      }
      if (!addresses.length || rejected) {
        const summary = addresses.length
          ? `rejected ${rejected}/${addresses.length} answers [${details.join("; ")}]${rejected > details.length ? `; ${rejected - details.length} more rejected answers omitted` : ""}`
          : "no address answers";
        callback(new WcEndpointPolicyError(pluginId, `host '${host}' did not resolve exclusively to public addresses: ${summary}`), "", 4);
        return;
      }
      if (options.all) callback(null, [...addresses]);
      else callback(null, addresses[0].address, addresses[0].family);
    }, (error: unknown) => {
      // Native errors may contain arbitrary request/resolver data. Only relay
      // known DNS codes, not their messages, stacks or other properties.
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      const safeCode = typeof code === "string" &&
        ["ENOTFOUND", "ENODATA", "EAI_AGAIN", "EAI_FAIL", "ETIMEOUT", "ESERVFAIL", "ECONNREFUSED"].includes(code)
        ? ` (${code})` : "";
      callback(new WcEndpointPolicyError(pluginId, `DNS resolution failed for host '${host}'${safeCode}`), "", 4);
    });
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
