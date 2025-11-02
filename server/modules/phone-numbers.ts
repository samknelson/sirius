import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { insertPhoneNumberSchema } from "@shared/schema";
import { phoneValidationService } from "../services/phone-validation";

// Type for middleware functions
type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerPhoneNumberRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {
  
  // GET /api/contacts/:contactId/phone-numbers - Get all phone numbers for a contact
  app.get("/api/contacts/:contactId/phone-numbers", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { contactId } = req.params;
      const phoneNumbers = await storage.getPhoneNumbersByContact(contactId);
      res.json(phoneNumbers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch phone numbers" });
    }
  });

  // GET /api/phone-numbers/:id - Get specific phone number
  app.get("/api/phone-numbers/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const phoneNumber = await storage.getPhoneNumber(id);
      
      if (!phoneNumber) {
        return res.status(404).json({ message: "Phone number not found" });
      }
      
      res.json(phoneNumber);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch phone number" });
    }
  });

  // POST /api/contacts/:contactId/phone-numbers - Create new phone number for a contact
  app.post("/api/contacts/:contactId/phone-numbers", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { contactId } = req.params;
      
      // Validate and format the phone number
      const validationResult = await phoneValidationService.validateAndFormat(req.body.phoneNumber);
      
      if (!validationResult.isValid) {
        return res.status(400).json({ 
          message: validationResult.error || "Invalid phone number",
          error: validationResult.error
        });
      }
      
      const phoneNumberData = insertPhoneNumberSchema.parse({ 
        ...req.body,
        phoneNumber: validationResult.e164Format,
        contactId,
        validationResponse: validationResult
      });
      
      const newPhoneNumber = await storage.createPhoneNumber(phoneNumberData);
      res.status(201).json(newPhoneNumber);
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid phone number data", errors: error });
      }
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Failed to create phone number" });
    }
  });

  // PUT /api/phone-numbers/:id - Update phone number
  app.put("/api/phone-numbers/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      
      // If phone number is being updated, validate and format it
      let updateData: any = { ...req.body };
      if (req.body.phoneNumber) {
        const validationResult = await phoneValidationService.validateAndFormat(req.body.phoneNumber);
        
        if (!validationResult.isValid) {
          return res.status(400).json({ 
            message: validationResult.error || "Invalid phone number",
            error: validationResult.error
          });
        }
        
        updateData.phoneNumber = validationResult.e164Format;
        updateData.validationResponse = validationResult;
      }
      
      // Parse the update data, but don't require contactId since it shouldn't change
      const parsedUpdateData = insertPhoneNumberSchema.partial().omit({ contactId: true }).parse(updateData);
      
      const updatedPhoneNumber = await storage.updatePhoneNumber(id, parsedUpdateData);
      
      if (!updatedPhoneNumber) {
        return res.status(404).json({ message: "Phone number not found" });
      }
      
      res.json(updatedPhoneNumber);
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid phone number data", errors: error });
      }
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Failed to update phone number" });
    }
  });

  // PUT /api/phone-numbers/:id/set-primary - Set phone number as primary
  app.put("/api/phone-numbers/:id/set-primary", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      
      // First get the phone number to know the contactId
      const currentPhoneNumber = await storage.getPhoneNumber(id);
      if (!currentPhoneNumber) {
        return res.status(404).json({ message: "Phone number not found" });
      }
      
      const updatedPhoneNumber = await storage.setPhoneNumberAsPrimary(id, currentPhoneNumber.contactId);
      
      if (!updatedPhoneNumber) {
        return res.status(404).json({ message: "Failed to set phone number as primary" });
      }
      
      res.json(updatedPhoneNumber);
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Failed to set phone number as primary" });
    }
  });

  // DELETE /api/phone-numbers/:id - Delete phone number
  app.delete("/api/phone-numbers/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deletePhoneNumber(id);
      
      if (!deleted) {
        return res.status(404).json({ message: "Phone number not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete phone number" });
    }
  });
}
