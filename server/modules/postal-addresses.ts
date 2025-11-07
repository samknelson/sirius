import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { insertPostalAddressSchema } from "@shared/schema";

// Type for middleware functions that we'll accept from the main routes
type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

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

export function registerPostalAddressRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {
  
  // GET /api/contacts/:contactId/addresses - Get all addresses for a contact
  app.get("/api/contacts/:contactId/addresses", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { contactId } = req.params;
      const addresses = await storage.contacts.addresses.getPostalAddressesByContact(contactId);
      res.json(addresses);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch addresses" });
    }
  });

  // GET /api/addresses/:id - Get specific address
  app.get("/api/addresses/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const address = await storage.contacts.addresses.getPostalAddress(id);
      
      if (!address) {
        return res.status(404).json({ message: "Address not found" });
      }
      
      res.json(address);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch address" });
    }
  });

  // POST /api/contacts/:contactId/addresses - Create new address for a contact
  app.post("/api/contacts/:contactId/addresses", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { contactId } = req.params;
      
      // Extract geometry data from validationResponse if present
      const geometryData = extractGeometryFromValidationResponse(req.body.validationResponse);
      
      const addressData = insertPostalAddressSchema.parse({ 
        ...req.body,
        ...geometryData,
        contactId 
      });
      
      const newAddress = await storage.contacts.addresses.createPostalAddress(addressData);
      res.status(201).json(newAddress);
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

  // PUT /api/addresses/:id - Update address
  app.put("/api/addresses/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Extract geometry data from validationResponse if present
      const geometryData = extractGeometryFromValidationResponse(req.body.validationResponse);
      
      // Parse the update data, but don't require contactId since it shouldn't change
      const updateData = insertPostalAddressSchema.partial().omit({ contactId: true }).parse({
        ...req.body,
        ...geometryData,
      });
      
      const updatedAddress = await storage.contacts.addresses.updatePostalAddress(id, updateData);
      
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

  // PUT /api/addresses/:id/set-primary - Set address as primary
  app.put("/api/addresses/:id/set-primary", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      
      // First get the address to know the contactId
      const currentAddress = await storage.contacts.addresses.getPostalAddress(id);
      if (!currentAddress) {
        return res.status(404).json({ message: "Address not found" });
      }
      
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

  // DELETE /api/addresses/:id - Delete address
  app.delete("/api/addresses/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.contacts.addresses.deletePostalAddress(id);
      
      if (!deleted) {
        return res.status(404).json({ message: "Address not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete address" });
    }
  });
}