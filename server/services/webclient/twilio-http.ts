import RequestClient from "twilio/lib/base/RequestClient.js";
import type TwilioResponse from "twilio/lib/http/response.js";
import type { WcVendorHttp } from "./vendor-http";

/** Keep the SDK's API mapping, but never its independent Axios transport. */
export class WcTwilioHttpClient extends RequestClient {
  constructor(private readonly http: WcVendorHttp) { super(); }

  override async request<TData>(
    opts: RequestClient.RequestOptions<TData>,
  ): Promise<TwilioResponse<TData>> {
    const url = new URL(opts.uri);
    const append = (target: URLSearchParams, values: object | undefined) => {
      for (const [key, value] of Object.entries(values ?? {})) {
        if (value === undefined || value === null) continue;
        for (const item of Array.isArray(value) ? value : [value]) {
          target.append(key, String(item));
        }
      }
    };
    append(url.searchParams, opts.params);
    const headers = new Headers(opts.headers);
    headers.set("Authorization", opts.authStrategy
      ? await opts.authStrategy.getAuthString()
      : `Basic ${Buffer.from(`${opts.username ?? ""}:${opts.password ?? ""}`).toString("base64")}`);
    let body: string | undefined;
    if (opts.data !== undefined && opts.data !== null) {
      if (headers.get("content-type")?.includes("application/json")) {
        body = JSON.stringify(opts.data);
      } else {
        const form = new URLSearchParams();
        append(form, opts.data as object);
        body = form.toString();
        headers.set("Content-Type", "application/x-www-form-urlencoded");
      }
    }
    const response = await this.http.fetch(url, {
      method: opts.method, headers, body,
      ...(opts.timeout ? { signal: AbortSignal.timeout(opts.timeout) } : {}),
    });
    const text = await response.text();
    let value: unknown = text;
    try { value = JSON.parse(text); } catch { /* Some SDK endpoints return text. */ }
    // The SDK accepts this structural contract. Its response module's CJS
    // default export is not a constructor under native ESM (unlike tsx).
    const answer: TwilioResponse<TData> = {
      statusCode: response.status,
      body: value as TData,
      headers: Object.fromEntries(response.headers),
      toString() { return "HTTP " + this.statusCode + " " + this.body; },
    };
    this.lastResponse = answer;
    return answer;
  }
}
