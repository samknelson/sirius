import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { insertContactPostalSchema } from "@shared/schema";
import type { AddressSource } from "../storage/contacts";

// Type for middleware functions that we'll accept from the main routes
type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PolicyMiddleware = (policy: any, getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

// Helper function to extract geographic coordinates from Google validation response
function extractGeometryFromValidationResponse(validationResponse: any): {
  latitude?: number;
  longitude?: number;
  accuracy?: string;
} {
  if (!validationResponse || typeof validationResponse !== 'object') {
    return {};
  }

  const geometry = validationResponse.geometry;
  if (!geometry || typeof geometry !== 'object') {
    return {};
  }

  const location = geometry.location;
  const locationType = geometry.location_type;

  return {
    latitude: location?.lat,
    longitude: location?.lng,
    accuracy: locationType,
  };
}

export function registerContactPostalRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware,
  requireAccess?: PolicyMiddleware
) {

  // GET /api/contacts/:contactId/addresses
  app.get("/api/contacts/:contactId/addresses", requireAuth, async (req, res, next) => {
    if (!requireAccess) return next();

    const worker = await storage.workers.getWorkerByContactId(req.params.contactId);
    if (worker) {
      return requireAccess('worker.view', () => worker.id)(req, res, next);
    }

    const employerContacts = await storage.employerContacts.listByContactId(req.params.contactId);
    if (employerContacts && employerContacts.length > 0) {
      return requireAccess('employer.manage', () => employerContacts[0].employerId)(req, res, next);
    }

    const facility = await storage.facilities.getByContactId(req.params.contactId);
    if (facility) {
      return requireAccess('facility.view', () => facility.id)(req, res, next);
    }

    return requireAccess('staff')(req, res, next);
  }, async (req, res) => {
    try {
      const { contactId } = req.params;
      const addresses = await storage.contacts.addresses.getContactPostalByContact(contactId);
      res.json(addresses);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch addresses" });
    }
  });

  // GET /api/addresses/:id
  app.get("/api/addresses/:id", requireAuth, async (req, res, next) => {
    if (!requireAccess) return next();

    const address = await storage.contacts.addresses.getContactPostal(req.params.id);
    if (!address) {
      return res.status(404).json({ message: "Address not found" });
    }

    (req as any).addressRecord = address;
    return requireAccess('contact.view', () => address.contactId)(req, res, next);
  }, async (req, res) => {
    try {
      const address = (req as any).addressRecord;
      res.json(address);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch address" });
    }
  });

  // POST /api/contacts/:contactId/addresses - admin path (server forces source=admin)
  app.post("/api/contacts/:contactId/addresses", requireAuth, async (req, res, next) => {
    if (!requireAccess) return next();
    return requireAccess('contact.edit', () => req.params.contactId)(req, res, next);
  }, async (req, res) => {
    try {
      const { contactId } = req.params;

      const geometryData = extractGeometryFromValidationResponse(req.body.validationResponse);

      const source: AddressSource = "admin";
      const parsed = insertContactPostalSchema.parse({
        ...req.body,
        ...geometryData,
        contactId,
        source,
      });

      const { address: newAddress, isNew } = await storage.contacts.addresses.createOrMatchAddress(
        contactId,
        {
          street: parsed.street,
          city: parsed.city,
          state: parsed.state,
          postalCode: parsed.postalCode,
          country: parsed.country,
        },
        source,
        {
          friendlyName: parsed.friendlyName ?? undefined,
          latitude: parsed.latitude ?? undefined,
          longitude: parsed.longitude ?? undefined,
          accuracy: parsed.accuracy ?? undefined,
        },
      );
      res.status(isNew ? 201 : 200).json(newAddress);
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid address data", errors: error });
      }
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Failed to create address" });
    }
  });

  // POST /api/contacts/:contactId/addresses/self - worker self-service path (source=worker_self)
  // Authorization: in addition to contact.edit, the authenticated user MUST be the worker for this contact
  // (their email matches the contact's email and the contact belongs to a worker). This prevents privileged
  // non-worker actors from minting worker_self provenance records that would otherwise be considered
  // higher trust than admin-entered addresses.
  app.post("/api/contacts/:contactId/addresses/self", requireAuth, async (req, res, next) => {
    try {
      const { contactId } = req.params;
      const contact = await storage.contacts.getContact(contactId);
      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }
      const worker = await storage.workers.getWorkerByContactId(contactId);
      if (!worker) {
        return res.status(403).json({ message: "Worker self-service is only available for worker contacts." });
      }
      const userEmail = ((req.user as any)?.dbUser?.email ?? (req.user as any)?.email ?? "").toLowerCase();
      const contactEmail = (contact.email ?? "").toLowerCase();
      if (!userEmail || !contactEmail || userEmail !== contactEmail) {
        return res.status(403).json({ message: "You may only add a self-reported address to your own contact record." });
      }
    } catch (e) {
      return res.status(500).json({ message: "Failed to authorize worker-self request" });
    }
    if (!requireAccess) return next();
    return requireAccess('contact.edit', () => req.params.contactId)(req, res, next);
  }, async (req, res) => {
    try {
      const { contactId } = req.params;

      const geometryData = extractGeometryFromValidationResponse(req.body.validationResponse);

      const source: AddressSource = "worker_self";
      const parsed = insertContactPostalSchema.parse({
        ...req.body,
        ...geometryData,
        contactId,
        source,
      });

      const { address: newAddress, isNew } = await storage.contacts.addresses.createOrMatchAddress(
        contactId,
        {
          street: parsed.street,
          city: parsed.city,
          state: parsed.state,
          postalCode: parsed.postalCode,
          country: parsed.country,
        },
        source,
        {
          friendlyName: parsed.friendlyName ?? undefined,
          latitude: parsed.latitude ?? undefined,
          longitude: parsed.longitude ?? undefined,
          accuracy: parsed.accuracy ?? undefined,
        },
      );
      res.status(isNew ? 201 : 200).json(newAddress);
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid address data", errors: error });
      }
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Failed to create address" });
    }
  });

  // PUT /api/addresses/:id - update metadata; immutable address fields are stripped silently
  app.put("/api/addresses/:id", requireAuth, async (req, res, next) => {
    if (!requireAccess) return next();

    const address = await storage.contacts.addresses.getContactPostal(req.params.id);
    if (!address) {
      return res.status(404).json({ message: "Address not found" });
    }

    (req as any).addressRecord = address;
    return requireAccess('contact.edit', () => address.contactId)(req, res, next);
  }, async (req, res) => {
    try {
      const { id } = req.params;

      const geometryData = extractGeometryFromValidationResponse(req.body.validationResponse);

      // Strip immutable address fields, server-derived source, and system-managed
      // deliverability lifecycle fields. Deliverability state must only flow through
      // the verify-address pipeline (or markUndeliverable) so terminal-status side
      // effects (e.g. primary auto-promotion) cannot be bypassed by a metadata PUT.
      const {
        source: _source,
        street: _street,
        city: _city,
        state: _state,
        postalCode: _pc,
        country: _country,
        deliverabilityStatus: _ds,
        lastVerifiedAt: _lv,
        needsReview: _nr,
        // isActive is owned by the dedicated soft-delete endpoint (DELETE /api/addresses/:id);
        // strip it here so a metadata PUT cannot deactivate or revive a row outside that audit path.
        isActive: _ia,
        ...safeBody
      } = req.body;
      const updateData = insertContactPostalSchema.partial().omit({ contactId: true }).parse({
        ...safeBody,
        ...geometryData,
      });

      const updatedAddress = await storage.contacts.addresses.updateContactPostal(id, updateData);

      if (!updatedAddress) {
        return res.status(404).json({ message: "Address not found" });
      }

      res.json(updatedAddress);
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid address data", errors: error });
      }
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Failed to update address" });
    }
  });

  // PUT /api/addresses/:id/set-primary
  app.put("/api/addresses/:id/set-primary", requireAuth, async (req, res, next) => {
    if (!requireAccess) return next();

    const address = await storage.contacts.addresses.getContactPostal(req.params.id);
    if (!address) {
      return res.status(404).json({ message: "Address not found" });
    }

    (req as any).addressRecord = address;
    return requireAccess('contact.edit', () => address.contactId)(req, res, next);
  }, async (req, res) => {
    try {
      const { id } = req.params;
      const currentAddress = (req as any).addressRecord;

      const updatedAddress = await storage.contacts.addresses.setAddressAsPrimary(id, currentAddress.contactId);

      if (!updatedAddress) {
        return res.status(404).json({ message: "Failed to set address as primary" });
      }

      res.json(updatedAddress);
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Failed to set address as primary" });
    }
  });

  // PUT /api/addresses/:id/mark-undeliverable
  app.put("/api/addresses/:id/mark-undeliverable", requireAuth, async (req, res, next) => {
    if (!requireAccess) return next();
    const address = await storage.contacts.addresses.getContactPostal(req.params.id);
    if (!address) {
      return res.status(404).json({ message: "Address not found" });
    }
    return requireAccess('contact.edit', () => address.contactId)(req, res, next);
  }, async (req, res) => {
    try {
      const { id } = req.params;
      const updated = await storage.contacts.addresses.markUndeliverable(id);
      if (!updated) {
        return res.status(404).json({ message: "Address not found" });
      }
      res.json(updated);
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Failed to mark address as undeliverable" });
    }
  });

  // DELETE /api/addresses/:id - soft-delete (deactivate)
  app.delete("/api/addresses/:id", requireAuth, async (req, res, next) => {
    if (!requireAccess) return next();

    const address = await storage.contacts.addresses.getContactPostal(req.params.id);
    if (!address) {
      return res.status(404).json({ message: "Address not found" });
    }

    return requireAccess('contact.edit', () => address.contactId)(req, res, next);
  }, async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.contacts.addresses.deleteContactPostal(id);

      if (!deleted) {
        return res.status(404).json({ message: "Address not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete address" });
    }
  });
}
