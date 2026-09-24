import { getWebServiceContext } from "../../../middleware/webservice-auth";
import { storage } from "../../../storage";
import { registerWebServicePlugin } from "../registry";
import type { WebServiceOperationContext } from "../types";

/**
 * Return the calling client's own API document.
 *
 * The subject is ALWAYS whoever authenticated. There is deliberately no
 * parameter naming a client: this service is granted like any other, so a
 * client that could name its subject could enumerate the endpoints granted to
 * every other integrator — and the grant list is precisely the thing worth
 * keeping to its owner.
 */
async function runSwagger({ res }: WebServiceOperationContext): Promise<void> {
  const context = getWebServiceContext();
  if (!context) {
    // Unreachable through the dispatcher, which only runs handlers inside the
    // authenticated context. Refusing beats falling back to any other notion
    // of "the caller".
    res.status(500).json({
      error: "Cannot identify the calling client",
      code: "NO_REQUEST_CONTEXT",
    });
    return;
  }

  const client = await storage.wsClients.get(context.clientId);
  if (!client) {
    res.status(500).json({
      error: "Cannot identify the calling client",
      code: "CLIENT_NOT_FOUND",
    });
    return;
  }

  // Imported here rather than at module load: the builder reaches back into
  // the web service module graph this plugin is registered from.
  const { buildClientOpenApiDocument } = await import("../../../modules/webservices/openapi");
  res.json(await buildClientOpenApiDocument(client));
}

/**
 * Swagger — publishes an OpenAPI document describing the services the calling
 * client is granted, so an integrator can fetch their own current contract
 * rather than waiting for someone to email them a stale one.
 *
 * It is an ordinary web service on purpose: granting it is a deliberate act,
 * and it inherits the credential check, the grant check, the IP allowlist and
 * the request log without the dispatcher knowing anything about it.
 */
registerWebServicePlugin({
  id: "swagger-v1",
  name: "Swagger",
  description:
    "Publishes an OpenAPI document describing every web service the calling client is granted.",
  order: 2,
  operations: [
    {
      name: "swagger",
      methods: ["GET"],
      description:
        "Returns an OpenAPI 3.1 document for the authenticated client. It describes only the services that client is granted, and never contains a credential.",
      responseSchema: {
        type: "object",
        title: "OpenAPI document",
        description: "An OpenAPI 3.1 document.",
        required: ["openapi", "info", "paths"],
        properties: {
          openapi: { type: "string", examples: ["3.1.0"] },
          info: { type: "object" },
          servers: { type: "array", items: { type: "object" } },
          components: { type: "object" },
          security: { type: "array", items: { type: "object" } },
          paths: { type: "object" },
        },
      },
      handler: runSwagger,
    },
  ],
});
