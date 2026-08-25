import { storage } from "../../storage";
import { isPluginComponentEnabledAsync } from "../../plugins/_core";
import { webServiceRegistry } from "../../plugins/web-service";
import { getPublicBaseUrl } from "../../services/comm/callback-handlers/url-builder";
import { WEB_SERVICE_BASE_PATH } from "./base-path";
import { addressForConfig, type ServiceAddress } from "./addressing";
import type { WebServiceMethod } from "../../plugins/web-service";
import type { PluginConfig, WsClient } from "@shared/schema";

/**
 * The generated API document for one web service client.
 *
 * It is built from the client's grants and nothing else, so it describes
 * exactly the services that client can actually reach: a service it is not
 * granted, or one that is switched off, is absent rather than listed as
 * forbidden. The document carries no credential — an integrator authenticates
 * with the key and secret they were given out of band, and the document only
 * names the headers to put them in.
 */
export interface OpenApiDocument {
  openapi: string;
  info: Record<string, unknown>;
  servers: { url: string; description?: string }[];
  components: Record<string, unknown>;
  security: Record<string, string[]>[];
  paths: Record<string, Record<string, unknown>>;
}

/** Verbs that carry a request body, and so can show a declared request schema. */
const BODY_METHODS: WebServiceMethod[] = ["POST", "PUT", "PATCH"];

/**
 * The two ways the dispatcher accepts a credential. Both are published so an
 * integrator whose HTTP client only does Basic auth can see that it is
 * supported; neither carries a value.
 */
const SECURITY_SCHEMES = {
  wsClientKey: {
    type: "apiKey",
    in: "header",
    name: "X-WS-Client-Key",
    description: "Client key. Sent together with X-WS-Client-Secret.",
  },
  wsClientSecret: {
    type: "apiKey",
    in: "header",
    name: "X-WS-Client-Secret",
    description: "Client secret. Sent together with X-WS-Client-Key.",
  },
  wsBasicAuth: {
    type: "http",
    scheme: "basic",
    description:
      "HTTP Basic authentication, using the client key as the username and the client secret as the password.",
  },
} as const;

/**
 * Either header pair OR Basic — two alternatives, not two requirements. Within
 * the first alternative both header schemes are listed, because the dispatcher
 * needs both headers.
 */
const SECURITY_REQUIREMENTS: Record<string, string[]>[] = [
  { wsClientKey: [], wsClientSecret: [] },
  { wsBasicAuth: [] },
];

/** Human label for a configuration, falling back to its address. */
function labelOf(config: PluginConfig, address: ServiceAddress): string {
  const name = config.name?.trim();
  return name || address.value;
}

/**
 * Turn a plugin id and an operation name into a stable, unique operationId.
 * Code generators use it as a function name, so it must not collide across two
 * configurations backed by the same plugin — the configuration's address is
 * therefore part of it.
 */
function operationIdFor(address: string, operation: string, method: string): string {
  const slug = `${address}_${operation}_${method}`.replace(/[^A-Za-z0-9_]/g, "_");
  return slug.replace(/_+/g, "_");
}

/**
 * The services one client may call: its grants, narrowed to configurations
 * that would actually answer. The dispatcher refuses a disabled configuration,
 * an unregistered plugin and a plugin whose component is off, so listing any
 * of them here would document a call that cannot succeed.
 */
async function callableServices(clientId: string) {
  const grants = await storage.wsClientGrants.getByClient(clientId);
  if (grants.length === 0) return [];

  // Every web service configuration, not just the granted ones: the address a
  // granted service is reachable at depends on the OTHERS too, because an
  // alias another configuration shares — or that another configuration's id is
  // spelled the same as — is not one the dispatcher will resolve here.
  const configs = await storage.pluginConfigs.getByKind("web-service");
  const byId = new Map(configs.map((c) => [c.id, c]));

  const services: {
    config: PluginConfig;
    plugin: NonNullable<ReturnType<typeof webServiceRegistry.get>>;
    address: ServiceAddress;
  }[] = [];
  for (const grant of grants) {
    const config = byId.get(grant.configId);
    if (!config || !config.enabled) continue;

    const plugin = webServiceRegistry.get(config.pluginId);
    if (!plugin) continue;
    if (!(await isPluginComponentEnabledAsync(webServiceRegistry.getMetadata(plugin)))) continue;

    services.push({ config, plugin, address: addressForConfig(config, configs) });
  }

  // Stable, readable ordering: by the label the reader sees.
  return services.sort((a, b) =>
    labelOf(a.config, a.address).localeCompare(labelOf(b.config, b.address)),
  );
}

/** What the document says about an address that is a configuration id. */
const ADDRESS_NOTES: Record<ServiceAddress["reason"], string | null> = {
  alias: null,
  "no-alias":
    "This service has no alias, so it is addressed by a configuration id that exists only in this environment.",
  "ambiguous-alias":
    "This service's alias names more than one configuration, which this installation refuses to resolve, so it is addressed by a configuration id that exists only in this environment.",
  "alias-shadowed-by-id":
    "This service's alias is spelled the same as another configuration's id, and ids are matched first, so it is addressed by its own configuration id — which exists only in this environment.",
};

/** The responses every operation shares, because the framework guarantees them. */
function frameworkResponses(): Record<string, unknown> {
  return {
    "401": {
      description:
        "The credential is missing, invalid, inactive, or the client is not active or is calling from a disallowed address.",
    },
    "404": {
      description:
        "This service is not reachable by this client: it does not exist, is switched off, or is not granted. The reasons are deliberately indistinguishable.",
    },
  };
}

/**
 * Build the API document describing everything `client` may call.
 *
 * This is the ONE builder. The admin download and the swagger web service both
 * call it, so an administrator can never be looking at a document that differs
 * from the one the integrator fetches.
 */
export async function buildClientOpenApiDocument(client: WsClient): Promise<OpenApiDocument> {
  const services = await callableServices(client.id);

  const paths: Record<string, Record<string, unknown>> = {};
  let anyDatabaseIdAddress = false;

  for (const { config, plugin, address } of services) {
    if (address.isDatabaseId) anyDatabaseIdAddress = true;
    const label = labelOf(config, address);

    for (const op of plugin.operations) {
      const path = `${WEB_SERVICE_BASE_PATH}/${address.value}/${op.name}`;
      const entry = paths[path] ?? (paths[path] = {});

      for (const method of op.methods) {
        const notes: string[] = [op.description];
        const addressNote = ADDRESS_NOTES[address.reason];
        if (addressNote) notes.push(addressNote);
        if (BODY_METHODS.includes(method) && !op.requestSchema) {
          notes.push("The request body is not described by this service.");
        }
        if (!op.responseSchema) {
          notes.push("The response body is not described by this service.");
        }

        const operation: Record<string, unknown> = {
          operationId: operationIdFor(address.value, op.name, method),
          summary: `${label}: ${op.name}`,
          description: notes.join("\n\n"),
          tags: [label],
          responses: {
            "200": {
              description: "Success.",
              ...(op.responseSchema
                ? { content: { "application/json": { schema: op.responseSchema } } }
                : {}),
            },
            ...frameworkResponses(),
          },
        };

        if (BODY_METHODS.includes(method) && op.requestSchema) {
          operation.requestBody = {
            required: true,
            content: { "application/json": { schema: op.requestSchema } },
          };
        }

        entry[method.toLowerCase()] = operation;
      }
    }
  }

  const baseUrl = getPublicBaseUrl();
  const descriptionParts = [
    `Web services available to the client "${client.name}".`,
    "Every operation is authenticated with this client's own key and secret; the document never contains them.",
    "A service granted to another client, or switched off, does not appear here.",
  ];
  if (anyDatabaseIdAddress) {
    descriptionParts.push(
      "Some services below are addressed by a configuration id rather than an alias. Those ids are specific to the environment this document was generated from.",
    );
  }
  if (Object.keys(paths).length === 0) {
    descriptionParts.push("This client is currently granted no callable service.");
  }

  return {
    openapi: "3.1.0",
    info: {
      title: `${client.name} — Web Services`,
      version: "1.0.0",
      description: descriptionParts.join("\n\n"),
    },
    servers: [
      baseUrl
        ? { url: baseUrl, description: "This installation." }
        : {
            url: "/",
            // No public URL is configured, so the only honest server is a
            // relative one: emitting a localhost URL would hand the integrator
            // an address that resolves to their own machine.
            description:
              "Relative to this installation's own host; no public URL is configured for it.",
          },
    ],
    components: { securitySchemes: SECURITY_SCHEMES },
    security: SECURITY_REQUIREMENTS,
    paths,
  };
}
