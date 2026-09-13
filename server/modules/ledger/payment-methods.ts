import type { Express, Request, Response } from "express";
import { storage } from "../../storage";
import {
  checkAccessInline,
  getComponentChecker,
} from "../../services/access-policy-evaluator";
import { listPaymentGatewayConfigs } from "./payment-gateway-capability";
import { wcRequest, type WcResult } from "../../services/webclient";
import {
  describeWcVendor,
  WcVendorError,
  type WcVendorDescription,
} from "../../services/webclient/wc-vendor-context";
import {
  isMaintenanceModeError,
  sendIfMaintenanceRefusal,
} from "../../services/maintenance-flag";

/**
 * Provider-generic payment-method management.
 *
 * The page talks ONLY to these generic CRUD routes, each keyed by an entity and
 * a gateway CONFIG id. All Stripe (or any provider) behaviour lives behind the
 * wc-vendors plugin; this module orchestrates storage + plugin calls and
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
async function isPluginComponentEnabled(gateway: WcVendorDescription): Promise<boolean> {
  const component = gateway.requiredComponent;
  if (!component) return true;
  const checker = getComponentChecker();
  if (!checker) return false;
  return checker(component);
}

/** Enforce the resolved plugin's component gate or 403. */
async function assertPluginComponent(gateway: WcVendorDescription): Promise<void> {
  const component = gateway.requiredComponent;
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
async function resolveMethodGateway(
  gatewayConfigId: string,
): Promise<WcVendorDescription> {
  const gateway = await describeWcVendor({ configId: gatewayConfigId });
  await assertPluginComponent(gateway);
  return gateway;
}

/**
 * The value a gateway call produced, or the reason there is none, as something
 * this module's responder already knows how to report.
 *
 * The framework answers every call the same way — a result, never a throw for
 * anything the far end did — which is what lets a caller stop caring how a
 * vendor is implemented. These routes are the other kind of code: they turn
 * outcomes into HTTP, and they have always done it by catching. So the
 * translation happens here, once, and the routes below read as they did.
 *
 * The provider's own error object goes back up unchanged when there is one.
 * Two routes read `code === "resource_missing"` off it to answer 404, and the
 * responder reads a provider's 4xx status to pass the real message through;
 * both would silently become 500s if this threw a summary instead.
 */
function answered<TValue>(result: WcResult<TValue>): TValue {
  if (result.outcome === "success") return result.value as TValue;
  if (result.cause !== undefined) throw result.cause;
  throw new HttpError(
    503,
    result.error ?? "The payment gateway did not answer.",
  );
}

/**
 * Ensure a provider customer exists for (entity, gateway config), creating one
 * via the plugin and recording the mapping on first use. Returns the provider
 * customer reference.
 */
async function ensureCustomer(
  entityType: string,
  entityId: string,
  gateway: WcVendorDescription,
): Promise<string> {
  const vendor = { configId: gateway.configId };
  const existing = await storage.ledger.gatewayCustomers.get(
    entityType,
    entityId,
    gateway.configId,
  );
  if (existing) {
    // Reuse the mapping unless the plugin can verify the provider customer is
    // gone, in which case fall through to recreate and repair the mapping.
    if (!gateway.operations.includes("retrieve-customer")) {
      return existing.customerRef;
    }
    const { exists } = answered(
      await wcRequest({
        vendor,
        operation: "retrieve-customer",
        args: { customerRef: existing.customerRef },
      }),
    );
    if (exists) return existing.customerRef;
  }

  const descriptor = await entityConfigOrThrow(entityType).loadDescriptor(entityId);
  if (!descriptor) {
    throw new HttpError(404, "Entity not found");
  }

  const { customerRef } = answered(
    await wcRequest({
      vendor,
      operation: "create-customer",
      args: { name: descriptor.name, metadata: descriptor.metadata },
    }),
  );

  await storage.ledger.gatewayCustomers.upsert({
    entityType,
    entityId,
    gatewayConfigId: gateway.configId,
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
  // A maintenance refusal carries a 503 and its own explanation. It has to be
  // recognised before the provider-status branch below, which only surfaces
  // 4xx and would otherwise bury the explanation under a generic 500.
  if (sendIfMaintenanceRefusal(res, error)) return;
  if (error instanceof HttpError || error instanceof WcVendorError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  // Provider validation errors (e.g. Stripe `StripeInvalidRequestError`) and the
  // gateway setup guard expose a 4xx `statusCode`/`status`. Surface their real,
  // actionable message instead of masking it as a generic 500.
  const providerStatus =
    typeof (error as { statusCode?: unknown })?.statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : typeof (error as { status?: unknown })?.status === "number"
        ? (error as { status: number }).status
        : undefined;
  if (
    providerStatus !== undefined &&
    providerStatus >= 400 &&
    providerStatus < 500
  ) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(providerStatus).json({ message });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  res.status(500).json({ message: fallback, error: message });
}

export function registerLedgerPaymentMethodRoutes(app: Express): void {
  const base = "/api/ledger/payment-methods/:entityType/:entityId";

  // List the gateway configs available for the picker.
  //
  // Payment-gateway capability is part of the filter, not just enablement: the
  // wc-vendors kind is component-neutral, so a registered vendor need not be a
  // payment gateway at all. Offering one here would let it be attached to a
  // payment method, and every later customer or method call against it would
  // fail as an unsupported operation.
  app.get(`${base}/gateways`, async (req: Request, res: Response) => {
    try {
      const { entityType, entityId } = req.params;
      await assertEntityAccess(req, entityType, entityId);

      res.json(await listPaymentGatewayConfigs());
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

      const gateway = await describeWcVendor({ configId: gatewayConfigId });
      await assertPluginComponent(gateway);

      const customerRef = await ensureCustomer(entityType, entityId, gateway);

      try {
        const customer = answered(
          await wcRequest({
            vendor: { configId: gateway.configId },
            operation: "get-customer-details",
            args: { customerRef },
          }),
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

      // Describe each distinct gateway config once.
      const gatewayByConfig = new Map<string, WcVendorDescription | null>();
      const enriched = [];
      for (const pm of methods) {
        let gateway = gatewayByConfig.get(pm.gatewayConfigId);
        if (gateway === undefined) {
          try {
            gateway = await describeWcVendor({ configId: pm.gatewayConfigId });
          } catch {
            gateway = null;
          }
          gatewayByConfig.set(pm.gatewayConfigId, gateway);
        }

        if (!gateway || !(await isPluginComponentEnabled(gateway))) {
          enriched.push({ ...pm, providerError: "Payment gateway unavailable" });
          continue;
        }

        try {
          const providerDetails = answered(
            await wcRequest({
              vendor: { configId: gateway.configId },
              operation: "get-method-summary",
              args: { methodRef: pm.paymentMethod },
            }),
          );
          enriched.push({ ...pm, providerDetails });
        } catch (error) {
          // A refusal is not a missing method. Saying "not found at provider"
          // during maintenance would accuse the vendor of losing something we
          // never asked it about, so report why we did not ask.
          enriched.push({
            ...pm,
            providerError: isMaintenanceModeError(error)
              ? error.message
              : "Payment method not found at provider",
          });
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

      const gateway = await describeWcVendor({ configId: gatewayConfigId });
      await assertPluginComponent(gateway);

      const customerRef = await ensureCustomer(entityType, entityId, gateway);
      const session = answered(
        await wcRequest({
          vendor: { configId: gateway.configId },
          operation: "create-setup-session",
          args: { customerRef },
        }),
      );

      res.json({
        clientSecret: session.clientSecret,
        componentId: gateway.addComponentId ?? null,
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

      const gateway = await describeWcVendor({ configId: gatewayConfigId });
      await assertPluginComponent(gateway);

      const customerRef = await ensureCustomer(entityType, entityId, gateway);
      answered(
        await wcRequest({
          vendor: { configId: gateway.configId },
          operation: "attach-method",
          args: { customerRef, methodToken },
        }),
      );

      const existing = await storage.ledger.paymentMethods.getByEntity(
        entityType,
        entityId,
      );
      // First method added for a given gateway becomes that gateway's default.
      const hasMethodForGateway = existing.some(
        (m) => m.gatewayConfigId === gatewayConfigId,
      );
      const created = await storage.ledger.paymentMethods.create({
        entityType,
        entityId,
        paymentMethod: methodToken,
        gatewayConfigId,
        isActive: true,
        isDefault: !hasMethodForGateway,
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
        method.gatewayConfigId,
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

      const gateway = await resolveMethodGateway(method.gatewayConfigId);

      try {
        const details = answered(
          await wcRequest({
            vendor: { configId: gateway.configId },
            operation: "get-method-details",
            args: { methodRef: method.paymentMethod },
          }),
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

      const gateway = await resolveMethodGateway(method.gatewayConfigId);

      // Best-effort detach; still delete the row if the provider no longer has it.
      try {
        answered(
          await wcRequest({
            vendor: { configId: gateway.configId },
            operation: "detach-method",
            args: { methodRef: method.paymentMethod },
          }),
        );
      } catch (error) {
        // "Best effort" covers the provider having lost the method, not the
        // site having declined to call it. Deleting the row after a refusal
        // would strand a live method at the vendor that nothing here can
        // reach, so let the refusal end the request instead.
        if (isMaintenanceModeError(error)) throw error;
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
