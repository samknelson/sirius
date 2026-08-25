import { registerWebServicePlugin } from "../registry";
import type { WebServiceOperationContext } from "../types";

/**
 * Whether the caller actually sent a request body.
 *
 * `express.json()` assigns `req.body = {}` to every request before it decides
 * whether to parse one, so an empty object is what a GET, a body-less POST and
 * a body under an unparsed content type all look like. The request framing
 * headers are the only honest signal, so they are what decides between
 * "nothing was sent" and "this is what we parsed".
 */
function hasRequestBody(headers: Record<string, unknown>): boolean {
  if (typeof headers["transfer-encoding"] === "string") return true;
  const length = headers["content-length"];
  return typeof length === "string" && /^\d+$/.test(length) && Number(length) > 0;
}

/**
 * Echo the request back to its sender. Nothing is read, nothing is written,
 * and no state is consulted: the answer is derived entirely from what arrived.
 */
function runPing({ req, res }: WebServiceOperationContext): void {
  const headers = req.headers as Record<string, unknown>;
  const contentType = typeof headers["content-type"] === "string" ? headers["content-type"] : null;

  res.json({
    ok: true,
    method: req.method.toUpperCase(),
    receivedAt: new Date().toISOString(),
    // The content type is reported because it is what decided how (and
    // whether) the body below was parsed — a body sent as text/plain is not
    // parsed by this app and arrives here as an empty object.
    contentType,
    query: req.query ?? {},
    body: hasRequestBody(headers) ? (req.body ?? null) : null,
  });
}

/**
 * Ping — the neutral service an integrator can call while proving out a new
 * client credential, before any real service is involved. It reports the
 * method, the parsed query and the parsed body, and nothing about the server:
 * no version, no health, and never the caller's own credential back.
 */
registerWebServicePlugin({
  id: "ping-v1",
  name: "Ping",
  description:
    "Connectivity test: echoes back the request method, query and body exactly as this server parsed them.",
  order: 1,
  operations: [
    {
      name: "ping",
      methods: ["GET", "POST"],
      description:
        "Echoes the request. Send any query parameters, and on POST any JSON or form body; " +
        "the response reports what the server parsed.",
      // No request schema: the point of ping is that ANY body is accepted, so
      // any shape declared here would be a lie about what it refuses.
      responseSchema: {
        type: "object",
        title: "Ping echo",
        required: ["ok", "method", "receivedAt", "contentType", "query", "body"],
        properties: {
          ok: { type: "boolean", const: true },
          method: { type: "string", enum: ["GET", "POST"] },
          receivedAt: {
            type: "string",
            format: "date-time",
            description: "When this server handled the request.",
          },
          contentType: {
            type: ["string", "null"],
            description:
              "The Content-Type header as received; null when none was sent. This is what decided how the body below was parsed.",
          },
          query: {
            type: "object",
            description:
              "The parsed query string. A parameter repeated in the URL appears as an array.",
          },
          body: {
            type: ["object", "array", "string", "number", "boolean", "null"],
            description:
              "The parsed request body, or null when no body was sent or the content type was one this server does not parse.",
          },
        },
      },
      handler: runPing,
    },
  ],
});
