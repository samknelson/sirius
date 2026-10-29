import { request as httpRequest } from "node:http";
import { getEnvironmentVariable } from "../../config/env-registry";
import { assertExternalServiceAllowed } from "../../services/maintenance-flag";
import { LOCAL_WS_TEST_HEADER, localWsTestToken } from "./local-test-access";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

export interface WsTestHttpResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: unknown;
}

export async function executeWsTestHttp(
  path: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
): Promise<WsTestHttpResult> {
  assertExternalServiceAllowed("Web service test", "execute request");
  // This transport can only call the local dispatcher. Never resolve a
  // caller-provided hostname, including one disguised as a relative URL.
  const url = new URL(path, `http://127.0.0.1:${getEnvironmentVariable("PORT") || 5000}`);
  if (!path.startsWith("/api/ws/") || url.pathname !== path.split("?")[0]
      || !/^\/api\/ws\/[^/]+\/[^/]+$/.test(url.pathname)
      || url.hostname !== "127.0.0.1") {
    throw new Error("Only local web services can be tested");
  }
  return new Promise(function sendLocalTestRequest(resolve, reject) {
    const req = httpRequest(url, {
      method,
      headers: { ...headers, [LOCAL_WS_TEST_HEADER]: localWsTestToken() },
      agent: false,
      timeout: REQUEST_TIMEOUT_MS,
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