import type { Express, Request, Response } from "express";
import { storage } from "../../storage";
import {
  checkAccessInline,
  getComponentChecker,
} from "../../services/access-policy-evaluator";
import { getPaymentGatewayPlugin } from "../../plugins/ledger/payment-gateway";
import {
  resolveGateway,
  GatewayResolutionError,
  type ResolvedGateway,
} from "./payment-gateway-context";

/**
 * Provider-generic payment-method management.
 *
 * The page talks ONLY to these generic CRUD routes, each keyed by an entity and
 * a gateway CONFIG id. All Stripe (or any provider) behaviour lives behind the
 * payment-gateway plugin; this module orchestrates storage + plugin calls and
 * stays provider-agnostic.
 *
 * Access is entity-driven: the entity type maps to an access policy, and the
 * resolved plugin's `requiredComponent` is checked on top. Neither the
 * `ledger.stripe` component nor the `ledger.stripe.employer` policy is
 * hardcoded.
 */

interface EntityDescriptor {
  name: string;
  metadata: Record<string, string>;
}

interface EntityConfig {
  /** Entity-scoped access policy id. */
  policy: string;
  /** Load the provider-customer descriptor for this entity, or null if absent. */
  loadDescriptor: (entityId: string) => Promise<EntityDescriptor | null>;
}

/**
 * Entity-type -> access policy + descriptor loader. Only `employer` exists
 * today; new entity types are added here without touching the route handlers.
 */
const ENTITY_CONFIG: Record<string, EntityConfig> = {
  employer: {
    policy: "employer.ledger",
    loadDescriptor: async (entityId) => {
      const employer = await storage.employers.getEmployer(entityId);
      if (!employer) return null;
      return {
        name: employer.name,
        metadata: {
          employer_id: employer.id,
          sirius_id: String(employer.siriusId ?? ""),
        },
      };
    },
  },
};

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

/** Resolve the entity config or 400. */
function entityConfigOrThrow(entityType: string): EntityConfig {
  const cfg = ENTITY_CONFIG[entityType];
  if (!cfg) {
    throw new HttpError(400, `Unsupported entity type: ${entityType}`);
  }
  return cfg;
}

/** Enforce the entity-scoped access policy or 403. */
async function assertEntityAccess(
  req: Request,
  entityType: string,
  entityId: string,
): Promise<void> {
  const cfg = entityConfigOrThrow(entityType);
  const { granted, reason } = await checkAccessInline(req, cfg.policy, entityId);
  if (!granted) {
    throw new HttpError(403, reason || "Access denied");
  }
}

/** Non-throwing check: is the resolved plugin's required component enabled? */
async function isPluginComponentEnabled(resolved: ResolvedGateway): Promise<boolean> {
  const component = resolved.plugin.requiredComponent;
  if (!component) return true;
  const checker = getComponentChecker();
  if (!checker) return false;
  return checker(component);
}

/** Enforce the resolved plugin's component gate or 403. */
async function assertPluginComponent(resolved: ResolvedGateway): Promise<void> {
  const component = resolved.plugin.requiredComponent;
  if (!component) return;
  const checker = getComponentChecker();
  if (!checker) {
    throw new HttpError(500, "Component checker not initialized");
  }
  if (!(await checker(component))) {
    throw new HttpError(403, `Component not enabled: ${component}`);
  }
}

/**
 * Resolve the gateway config for a stored method and enforce both that the
 * gateway is usable and its plugin component is enabled. Centralizes the gate
 * applied by every per-method route (patch, set-default, details, delete).
 */
async function resolveMethodGateway(gatewayConfigId: string): Promise<ResolvedGateway> {
  const resolved = await resolveGateway(gatewayConfigId);
  await assertPluginComponent(resolved);
  return resolved;
}

/**
 * Ensure a provider customer exists for (entity, gateway config), creating one
 * via the plugin and recording the mapping on first use. Returns the provider
 * customer reference.
 */
async function ensureCustomer(
  entityType: string,
  entityId: string,
  resolved: ResolvedGateway,
): Promise<string> {
  const existing = await storage.ledger.gatewayCustomers.get(
    entityType,
    entityId,
    resolved.config.id,
  );
  if (existing) {
    // Reuse the mapping unless the plugin can verify the provider customer is
    // gone, in which case fall through to recreate and repair the mapping.
    if (!resolved.plugin.retrieveCustomer) {
      return existing.customerRef;
    }
    const { exists } = await resolved.plugin.retrieveCustomer(
      resolved.context,
      existing.customerRef,
    );
    if (exists) return existing.customerRef;
  }

  const descriptor = await entityConfigOrThrow(entityType).loadDescriptor(entityId);
  if (!descriptor) {
    throw new HttpError(404, "Entity not found");
  }

  const { customerRef } = await resolved.plugin.createCustomer(resolved.context, {
    name: descriptor.name,
    metadata: descriptor.metadata,
  });

  await storage.ledger.gatewayCustomers.upsert({
    entityType,
    entityId,
    gatewayConfigId: resolved.config.id,
    customerRef,
  });

  return customerRef;
}

/** Load a payment method and confirm it belongs to (entityType, entityId). */
async function loadOwnedMethod(
  pmId: string,
  entityType: string,
  entityId: string,
) {
  const method = await storage.ledger.paymentMethods.get(pmId);
  if (!method) {
    throw new HttpError(404, "Payment method not found");
  }
  if (method.entityType !== entityType || method.entityId !== entityId) {
    throw new HttpError(403, "Payment method does not belong to this entity");
  }
  return method;
}

/** Translate thrown errors into a JSON response. */
function sendError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof HttpError || error instanceof GatewayResolutionError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  res.status(500).json({ message: fallback, error: message });
}

export function registerLedgerPaymentMethodRoutes(app: Express): void {
  const base = "/api/ledger/payment-methods/:entityType/:entityId";

  // List the gateway configs available for the picker (enabled configs whose
  // plugin component is enabled).
  app.get(`${base}/gateways`, async (req: Request, res: Response) => {
    try {
      const { entityType, entityId } = req.params;
      await assertEntityAccess(req, entityType, entityId);

      const configs = await storage.pluginConfigs.getByType("payment-gateway");
      const checker = getComponentChecker();
      const available = [];
      for (const cfg of configs) {
        if (!cfg.enabled) continue;
        const plugin = getPaymentGatewayPlugin(cfg.pluginId);
        if (!plugin) continue;
        if (
          plugin.requiredComponent &&
          checker &&
          !(await checker(plugin.requiredComponent))
        ) {
          continue;
        }
        available.push({ id: cfg.id, pluginId: cfg.pluginId, name: cfg.name });
      }
      res.json(available);
    } catch (error) {
      sendError(res, error, "Failed to fetch payment gateways");
    }
  });

  // Fetch the provider customer linked to this entity + gateway config. Ensures
  // a customer exists (creating + recording the mapping on first use, repairing
  // a stale mapping), then enriches via the plugin. Provider-generic.
  app.get(`${base}/customer/:gatewayConfigId`, async (req: Request, res: Response) => {
    try {
      const { entityType, entityId, gatewayConfigId } = req.params;
      if (!gatewayConfigId) {
        throw new HttpError(400, "gatewayConfigId is required");
      }
      await assertEntityAccess(req, entityType, entityId);

      // Always confirm the entity still exists locally, even when a customer
      // mapping is already present — otherwise a stale mapping would expose
      // provider customer details for a deleted entity (parity with the old
      // Stripe route, which 404'd on a missing employer).
      const descriptor = await entityConfigOrThrow(entityType).loadDescriptor(entityId);
      if (!descriptor) {
        throw new HttpError(404, "Entity not found");
      }

      const resolved = await resolveGateway(gatewayConfigId);
      await assertPluginComponent(resolved);

      const customerRef = await ensureCustomer(entityType, entityId, resolved);

      try {
        const customer = await resolved.plugin.getCustomerDetails(
          resolved.context,
          customerRef,
        );
        res.json({ customer, providerUrl: customer.providerUrl });
      } catch (error: any) {
        if (error?.code === "resource_missing") {
          throw new HttpError(404, "Customer no longer exists at the provider");
        }
        throw error;
      }
    } catch (error) {
      sendError(res, error, "Failed to fetch customer");
    }
  });

  // List payment methods for the entity, enriched with provider details.
  app.get(base, async (req: Request, res: Response) => {
    try {
      const { entityType, entityId } = req.params;
      await assertEntityAccess(req, entityType, entityId);

      const methods = await storage.ledger.paymentMethods.getByEntity(
        entityType,
        entityId,
      );

      // Resolve each distinct gateway config once.
      const resolvedByConfig = new Map<string, ResolvedGateway | null>();
      const enriched = [];
      for (const pm of methods) {
        let resolved = resolvedByConfig.get(pm.gatewayConfigId);
        if (resolved === undefined) {
          try {
            resolved = await resolveGateway(pm.gatewayConfigId);
          } catch {
            resolved = null;
          }
          resolvedByConfig.set(pm.gatewayConfigId, resolved);
        }

        if (!resolved || !(await isPluginComponentEnabled(resolved))) {
          enriched.push({ ...pm, providerError: "Payment gateway unavailable" });
          continue;
        }

        try {
          const providerDetails = await resolved.plugin.getMethodSummary(
            resolved.context,
            pm.paymentMethod,
          );
          enriched.push({ ...pm, providerDetails });
        } catch {
          enriched.push({ ...pm, providerError: "Payment method not found at provider" });
        }
      }

      res.json(enriched);
    } catch (error) {
      sendError(res, error, "Failed to fetch payment methods");
    }
  });

  // Begin adding a method: ensure a customer, return the provider collection
  // payload + which client component to render + any public config.
  app.post(`${base}/setup`, async (req: Request, res: Response) => {
    try {
      const { entityType, entityId } = req.params;
      const { gatewayConfigId } = req.body ?? {};
      if (!gatewayConfigId) {
        throw new HttpError(400, "gatewayConfigId is required");
      }
      await assertEntityAccess(req, entityType, entityId);

      const resolved = await resolveGateway(gatewayConfigId);
      await assertPluginComponent(resolved);

      const customerRef = await ensureCustomer(entityType, entityId, resolved);
      const session = await resolved.plugin.createSetupSession(resolved.context, {
        customerRef,
      });

      res.json({
        clientSecret: session.clientSecret,
        componentId: resolved.plugin.addComponentId ?? null,
        publicConfig: session.publicConfig,
      });
    } catch (error) {
      sendError(res, error, "Failed to start adding a payment method");
    }
  });

  // Attach a collected method and record it. First method becomes default.
  app.post(base, async (req: Request, res: Response) => {
    try {
      const { entityType, entityId } = req.params;
      const { gatewayConfigId, methodToken } = req.body ?? {};
      if (!gatewayConfigId) {
        throw new HttpError(400, "gatewayConfigId is required");
      }
      if (!methodToken) {
        throw new HttpError(400, "methodToken is required");
      }
      await assertEntityAccess(req, entityType, entityId);

      const resolved = await resolveGateway(gatewayConfigId);
      await assertPluginComponent(resolved);

      const customerRef = await ensureCustomer(entityType, entityId, resolved);
      await resolved.plugin.attachMethod(resolved.context, {
        customerRef,
        methodToken,
      });

      const existing = await storage.ledger.paymentMethods.getByEntity(
        entityType,
        entityId,
      );
      const created = await storage.ledger.paymentMethods.create({
        entityType,
        entityId,
        paymentMethod: methodToken,
        gatewayConfigId,
        isActive: true,
        isDefault: existing.length === 0,
      });

      res.json(created);
    } catch (error) {
      sendError(res, error, "Failed to add payment method");
    }
  });

  // Enable / disable a method.
  app.patch(`${base}/:pmId`, async (req: Request, res: Response) => {
    try {
      const { entityType, entityId, pmId } = req.params;
      const { isActive } = req.body ?? {};
      if (typeof isActive !== "boolean") {
        throw new HttpError(400, "isActive must be a boolean");
      }
      await assertEntityAccess(req, entityType, entityId);
      const method = await loadOwnedMethod(pmId, entityType, entityId);
      await resolveMethodGateway(method.gatewayConfigId);

      const updated = await storage.ledger.paymentMethods.update(pmId, { isActive });
      res.json(updated);
    } catch (error) {
      sendError(res, error, "Failed to update payment method");
    }
  });

  // Set a method as the default for the entity.
  app.post(`${base}/:pmId/set-default`, async (req: Request, res: Response) => {
    try {
      const { entityType, entityId, pmId } = req.params;
      await assertEntityAccess(req, entityType, entityId);
      const method = await loadOwnedMethod(pmId, entityType, entityId);
      await resolveMethodGateway(method.gatewayConfigId);

      const updated = await storage.ledger.paymentMethods.setAsDefault(
        pmId,
        entityType,
        entityId,
      );
      res.json(updated);
    } catch (error) {
      sendError(res, error, "Failed to set payment method as default");
    }
  });

  // Fetch full provider details for a method.
  app.get(`${base}/:pmId/details`, async (req: Request, res: Response) => {
    try {
      const { entityType, entityId, pmId } = req.params;
      await assertEntityAccess(req, entityType, entityId);
      const method = await loadOwnedMethod(pmId, entityType, entityId);

      const resolved = await resolveMethodGateway(method.gatewayConfigId);

      try {
        const details = await resolved.plugin.getMethodDetails(
          resolved.context,
          method.paymentMethod,
        );
        res.json({
          paymentMethod: details.paymentMethod,
          providerUrl: details.providerUrl,
        });
      } catch (error: any) {
        if (error?.code === "resource_missing") {
          throw new HttpError(404, "Payment method no longer exists at the provider");
        }
        throw error;
      }
    } catch (error) {
      sendError(res, error, "Failed to fetch payment method details");
    }
  });

  // Detach at the provider and delete the stored method.
  app.delete(`${base}/:pmId`, async (req: Request, res: Response) => {
    try {
      const { entityType, entityId, pmId } = req.params;
      await assertEntityAccess(req, entityType, entityId);
      const method = await loadOwnedMethod(pmId, entityType, entityId);

      const resolved = await resolveMethodGateway(method.gatewayConfigId);

      // Best-effort detach; still delete the row if the provider no longer has it.
      try {
        await resolved.plugin.detachMethod(resolved.context, method.paymentMethod);
      } catch (error) {
        console.warn(
          `Failed to detach payment method from provider: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      await storage.ledger.paymentMethods.delete(pmId);
      res.json({ success: true });
    } catch (error) {
      sendError(res, error, "Failed to delete payment method");
    }
  });
}
