import type { Express, Request, Response, NextFunction } from "express";
import { storage, createCommSmsOptinStorage } from "../storage";
import { insertPhoneNumberSchema, insertCommSmsOptinSchema } from "@shared/schema";
import { phoneValidationService, schedulePhoneRevalidation, type PhoneValidationResult } from "../services/comm/validators/phone";
import { checkAccessInline } from "../services/access-policy-evaluator";
import { z } from "zod";

const updateSmsOptinSchema = z.object({
  optin: z.boolean().optional(),
  allowlist: z.boolean().optional(),
});

// Type for middleware functions
type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PolicyMiddleware = (policy: any, getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const smsOptinStorage = createCommSmsOptinStorage();

export function registerPhoneNumberRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware,
  requireAccess?: PolicyMiddleware
) {
  
  // GET /api/contacts/:contactId/phone-numbers - Get all phone numbers for a contact
  // Uses worker.view policy for worker contacts, employer.manage for employer contacts, staff policy for others
  app.get("/api/contacts/:contactId/phone-numbers", requireAuth, async (req, res, next) => {
    if (!requireAccess) return next();
    
    // Check if this contact belongs to a worker
    const worker = await storage.workers.getWorkerByContactId(req.params.contactId);
    
    if (worker) {
      // Worker contact - use worker.view policy with worker ID
      return requireAccess('worker.view', () => worker.id)(req, res, next);
    }
    
    // Check if this contact belongs to an employer contact
    const employerContacts = await storage.employerContacts.listByContactId(req.params.contactId);
    if (employerContacts && employerContacts.length > 0) {
      // Employer contact — contacts can hold MULTIPLE links (across employers
      // and, since the 2026-08-05 multi-link change, several typed links to
      // one employer). Grant when the actor can manage ANY linked employer;
      // never authorize against an arbitrary first link.
      const employerIds = [...new Set(employerContacts.map((ec) => ec.employerId))];
      for (const employerId of employerIds) {
        const check = await checkAccessInline(req, 'employer.manage', employerId);
        if (check.granted) return next();
      }
      return res.status(403).json({
        message: 'Access denied',
        error: 'ACCESS_DENIED',
        policy: 'employer.manage',
        entityId: employerIds[0] ?? null,
      });
    }
    
    // Check if this contact belongs to a facility
    const facility = await storage.facilities.getByContactId(req.params.contactId);
    if (facility) {
      return requireAccess('facility.view', () => facility.id)(req, res, next);
    }
    
    // Other contact types - require staff permission
    return requireAccess('staff')(req, res, next);
  }, async (req, res) => {
    try {
      const { contactId } = req.params;
      const phoneNumbers = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(contactId);
      res.json(phoneNumbers);
      // Serve what is stored, then catch up out of band. Blocking the list on
      // the provider would mean one external call per unvalidated number
      // inside the page load.
      schedulePhoneRevalidation(phoneNumbers.filter((p) => p.isActive).map((p) => p.phoneNumber));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch phone numbers" });
    }
  });

  // GET /api/phone-numbers/:id - Get specific phone number
  // Uses contact.view policy
  app.get("/api/phone-numbers/:id", requireAuth, async (req, res, next) => {
    if (!requireAccess) return next();
    
    // Get phone number to find contactId for access check
    const phoneNumber = await storage.contacts.phoneNumbers.getPhoneNumber(req.params.id);
    if (!phoneNumber) {
      return res.status(404).json({ message: "Phone number not found" });
    }
    
    // Store phone number on request for handler
    (req as any).phoneRecord = phoneNumber;
    return requireAccess('contact.view', () => phoneNumber.contactId)(req, res, next);
  }, async (req, res) => {
    try {
      const phoneNumber = (req as any).phoneRecord;
      res.json(phoneNumber);
      if (phoneNumber?.isActive) schedulePhoneRevalidation(phoneNumber.phoneNumber);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch phone number" });
    }
  });

  // POST /api/contacts/:contactId/phone-numbers - Create new phone number for a contact
  // Uses contact.edit policy with contactId from params
  app.post("/api/contacts/:contactId/phone-numbers", requireAuth, async (req, res, next) => {
    if (!requireAccess) return next();
    return requireAccess('contact.edit', () => req.params.contactId)(req, res, next);
  }, async (req, res) => {
    try {
      const { contactId } = req.params;
      
      // Validate and format the phone number. `default` answers from the
      // stored validation when it is recent enough, so re-adding a number
      // somebody already validated costs nothing.
      const validationResult = await phoneValidationService.validateAndFormat(req.body.phoneNumber, { revalidate: 'default' });
      
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
      
      const newPhoneNumber = await storage.contacts.phoneNumbers.createPhoneNumber(phoneNumberData);
      
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
  // Uses contact.edit policy - lookup phone number first to get contactId
  app.put("/api/phone-numbers/:id", requireAuth, async (req, res, next) => {
    if (!requireAccess) return next();
    
    // Get phone number to find contactId for access check
    const phoneNumber = await storage.contacts.phoneNumbers.getPhoneNumber(req.params.id);
    if (!phoneNumber) {
      return res.status(404).json({ message: "Phone number not found" });
    }
    
    // Store phone number on request
    (req as any).phoneRecord = phoneNumber;
    return requireAccess('contact.edit', () => phoneNumber.contactId)(req, res, next);
  }, async (req, res) => {
    try {
      const { id } = req.params;
      
      // If phone number is being updated, validate and format it
      let updateData: any = { ...req.body };
      let validationResult: PhoneValidationResult | null = null;
      
      // The edit form posts the whole record, so the field being PRESENT is no
      // evidence that the digits changed. Compare against what is stored and
      // leave an unchanged number entirely alone.
      const currentPhoneNumber = (req as any).phoneRecord as { phoneNumber: string } | undefined;
      if (req.body.phoneNumber) {
        const normalized = await phoneValidationService.validateAndFormat(req.body.phoneNumber, {
          revalidate: 'never',
        });
        if (!normalized.isValid) {
          return res.status(400).json({
            message: normalized.error || "Invalid phone number",
            error: normalized.error
          });
        }

        const unchanged = currentPhoneNumber?.phoneNumber === normalized.e164Format;
        if (unchanged) {
          delete updateData.phoneNumber;
          delete updateData.validationResponse;
        } else {
          validationResult = await phoneValidationService.validateAndFormat(req.body.phoneNumber, {
            revalidate: 'default',
          });

          if (!validationResult.isValid) {
            return res.status(400).json({ 
              message: validationResult.error || "Invalid phone number",
              error: validationResult.error
            });
          }
          
          updateData.phoneNumber = validationResult.e164Format;
          updateData.validationResponse = validationResult;
        }
      }
      
      // Parse the update data, but don't require contactId since it shouldn't change
      const parsedUpdateData = insertPhoneNumberSchema.partial().omit({ contactId: true }).parse(updateData);
      
      const updatedPhoneNumber = await storage.contacts.phoneNumbers.updatePhoneNumber(id, parsedUpdateData);
      
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
  // Uses contact.edit policy - lookup phone number first to get contactId
  app.put("/api/phone-numbers/:id/set-primary", requireAuth, async (req, res, next) => {
    if (!requireAccess) return next();
    
    // Get phone number to find contactId for access check
    const phoneNumber = await storage.contacts.phoneNumbers.getPhoneNumber(req.params.id);
    if (!phoneNumber) {
      return res.status(404).json({ message: "Phone number not found" });
    }
    
    // Store phone number on request
    (req as any).phoneRecord = phoneNumber;
    return requireAccess('contact.edit', () => phoneNumber.contactId)(req, res, next);
  }, async (req, res) => {
    try {
      const { id } = req.params;
      const currentPhoneNumber = (req as any).phoneRecord;
      
      const updatedPhoneNumber = await storage.contacts.phoneNumbers.setPhoneNumberAsPrimary(id, currentPhoneNumber.contactId);
      
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
  // Uses contact.edit policy - lookup phone number first to get contactId
  app.delete("/api/phone-numbers/:id", requireAuth, async (req, res, next) => {
    if (!requireAccess) return next();
    
    // Get phone number to find contactId for access check
    const phoneNumber = await storage.contacts.phoneNumbers.getPhoneNumber(req.params.id);
    if (!phoneNumber) {
      return res.status(404).json({ message: "Phone number not found" });
    }
    
    return requireAccess('contact.edit', () => phoneNumber.contactId)(req, res, next);
  }, async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.contacts.phoneNumbers.deletePhoneNumber(id);
      
      if (!deleted) {
        return res.status(404).json({ message: "Phone number not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete phone number" });
    }
  });

  // POST /api/phone-numbers/:id/revalidate - Re-validate phone number and update sms_optin record
  // Uses contact.edit policy - lookup phone number first to get contactId
  app.post("/api/phone-numbers/:id/revalidate", requireAuth, async (req, res, next) => {
    if (!requireAccess) return next();
    
    // Get phone number to find contactId for access check
    const phoneNumber = await storage.contacts.phoneNumbers.getPhoneNumber(req.params.id);
    if (!phoneNumber) {
      return res.status(404).json({ message: "Phone number not found" });
    }
    
    // Store phone number on request
    (req as any).phoneRecord = phoneNumber;
    return requireAccess('contact.edit', () => phoneNumber.contactId)(req, res, next);
  }, async (req, res) => {
    try {
      const { id } = req.params;
      
      // Get the phone number record
      const phoneNumber = await storage.contacts.phoneNumbers.getPhoneNumber(id);
      if (!phoneNumber) {
        return res.status(404).json({ message: "Phone number not found" });
      }
      
      // Re-validate the phone number. The whole point of the action is to
      // ask again, so it ignores how recent the stored answer is.
      const validationResult = await phoneValidationService.validateAndFormat(phoneNumber.phoneNumber, { revalidate: 'always' });
      
      if (!validationResult.isValid) {
        return res.status(400).json({ 
          message: validationResult.error || "Phone number is no longer valid",
          error: validationResult.error
        });
      }
      
      // Update the phone number record with new validation response
      const updatedPhoneNumber = await storage.contacts.phoneNumbers.updatePhoneNumber(id, {
        validationResponse: validationResult
      });
      
      // Return the opt-in record with updated validation data
      const optinRecord = await smsOptinStorage.getSmsOptinByPhoneNumber(validationResult.e164Format || phoneNumber.phoneNumber);
      
      res.json({
        phoneNumber: updatedPhoneNumber,
        validation: {
          smsPossible: validationResult.smsPossible,
          voicePossible: validationResult.voicePossible,
          validatedAt: new Date(),
          type: validationResult.type,
          carrier: validationResult.twilioData?.carrier,
        },
        optinRecord
      });
    } catch (error) {
      console.error('Failed to revalidate phone number:', error);
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Failed to revalidate phone number" });
    }
  });

  // SMS Opt-in Routes (requires admin policy)
  if (requireAccess) {
    // GET /api/sms-optin/:phoneNumber - Get SMS opt-in status for a phone number
    app.get("/api/sms-optin/:phoneNumber", requireAuth, requireAccess('admin'), async (req, res) => {
      try {
        const { phoneNumber } = req.params;
        const optin = await smsOptinStorage.getSmsOptinByPhoneNumber(phoneNumber);
        
        if (!optin) {
          return res.json({ exists: false, optin: null });
        }
        
        // If we have an optin user, fetch their details
        let optinUserDetails = null;
        if (optin.optinUser) {
          const user = await storage.users.getUser(optin.optinUser);
          if (user) {
            optinUserDetails = {
              id: user.id,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
            };
          }
        }
        
        res.json({ 
          exists: true, 
          optin: {
            ...optin,
            optinUserDetails,
          }
        });
      } catch (error) {
        console.error("Failed to fetch SMS opt-in:", error);
        res.status(500).json({ message: "Failed to fetch SMS opt-in status" });
      }
    });

    // PUT /api/sms-optin/:phoneNumber - Create or update SMS opt-in for a phone number
    app.put("/api/sms-optin/:phoneNumber", requireAuth, requireAccess('admin'), async (req, res) => {
      try {
        const { phoneNumber } = req.params;
        
        const parsed = updateSmsOptinSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
        }
        
        const { optin, allowlist } = parsed.data;
        const user = (req as any).user;
        
        // Get client IP address
        const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown';
        const ip = clientIp.split(',')[0].trim();
        
        // Check if opt-in record already exists
        const existingOptin = await smsOptinStorage.getSmsOptinByPhoneNumber(phoneNumber);
        
        if (existingOptin) {
          // Update existing record
          const updateData: any = {};
          
          if (optin !== undefined) {
            updateData.optin = optin;
            if (optin) {
              updateData.optinUser = user?.id || null;
              updateData.optinDate = new Date();
              updateData.optinIp = ip;
            }
          }
          
          if (allowlist !== undefined) {
            updateData.allowlist = allowlist;
          }
          
          const updated = await smsOptinStorage.updateSmsOptinByPhoneNumber(phoneNumber, updateData);
          
          if (!updated) {
            return res.status(404).json({ message: "Failed to update SMS opt-in" });
          }
          
          // Fetch user details for response
          let optinUserDetails = null;
          if (updated.optinUser) {
            const optinUser = await storage.users.getUser(updated.optinUser);
            if (optinUser) {
              optinUserDetails = {
                id: optinUser.id,
                email: optinUser.email,
                firstName: optinUser.firstName,
                lastName: optinUser.lastName,
              };
            }
          }
          
          res.json({
            ...updated,
            optinUserDetails,
          });
        } else {
          // Create new record
          const validationResult = await phoneValidationService.validateAndFormat(phoneNumber, { revalidate: 'default' });
          if (!validationResult.isValid) {
            return res.status(400).json({ message: validationResult.error || "Invalid phone number" });
          }
          
          const newOptin = await smsOptinStorage.createSmsOptin({
            phoneNumber: validationResult.e164Format || phoneNumber,
            optin: optin ?? false,
            optinUser: optin ? (user?.id || null) : null,
            optinDate: optin ? new Date() : null,
            optinIp: optin ? ip : null,
            allowlist: allowlist ?? false,
          });
          
          // Fetch user details for response
          let optinUserDetails = null;
          if (newOptin.optinUser) {
            const optinUser = await storage.users.getUser(newOptin.optinUser);
            if (optinUser) {
              optinUserDetails = {
                id: optinUser.id,
                email: optinUser.email,
                firstName: optinUser.firstName,
                lastName: optinUser.lastName,
              };
            }
          }
          
          res.status(201).json({
            ...newOptin,
            optinUserDetails,
          });
        }
      } catch (error) {
        console.error("Failed to update SMS opt-in:", error);
        if (error instanceof Error) {
          return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: "Failed to update SMS opt-in status" });
      }
    });

    // GET /api/sms-optin/:phoneNumber/public-token - Get or create public token for a phone number
    app.get("/api/sms-optin/:phoneNumber/public-token", requireAuth, requireAccess('admin'), async (req, res) => {
      try {
        const { phoneNumber } = req.params;
        
        // Normalization only: minting a link for a number is not a question
        // about whether the carrier still has it.
        const validationResult = await phoneValidationService.validateAndFormat(phoneNumber, { revalidate: 'never' });
        if (!validationResult.isValid) {
          return res.status(400).json({ message: validationResult.error || "Invalid phone number" });
        }
        
        const token = await smsOptinStorage.getOrCreatePublicToken(validationResult.e164Format || phoneNumber);
        res.json({ token });
      } catch (error) {
        console.error("Failed to get/create public token:", error);
        res.status(500).json({ message: "Failed to get public token" });
      }
    });
  }

  // Public routes (no auth required)
  const publicOptinSchema = z.object({
    optin: z.boolean(),
  });

  // GET /api/public/sms-optin/:token - Get opt-in status by public token (no auth)
  app.get("/api/public/sms-optin/:token", async (req, res) => {
    try {
      const { token } = req.params;
      
      if (!token || token.length < 32) {
        return res.status(400).json({ message: "Invalid token" });
      }
      
      const optin = await smsOptinStorage.getSmsOptinByPublicToken(token);
      
      if (!optin) {
        return res.status(404).json({ message: "Opt-in record not found" });
      }
      
      // Return only necessary fields for the public page
      res.json({
        phoneNumber: optin.phoneNumber.replace(/(\+\d{1})\d{6}(\d{4})/, '$1******$2'),
        optin: optin.optin,
      });
    } catch (error) {
      console.error("Failed to fetch public opt-in:", error);
      res.status(500).json({ message: "Failed to fetch opt-in status" });
    }
  });

  // POST /api/public/sms-optin/:token - Update opt-in status by public token (no auth)
  app.post("/api/public/sms-optin/:token", async (req, res) => {
    try {
      const { token } = req.params;
      
      if (!token || token.length < 32) {
        return res.status(400).json({ message: "Invalid token" });
      }
      
      const parsed = publicOptinSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      
      const { optin } = parsed.data;
      
      // Get client IP address
      const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown';
      const ip = clientIp.split(',')[0].trim();
      
      const updateData: any = {
        optin,
        optinDate: new Date(),
        optinIp: ip,
        optinUser: null,
      };
      
      const updated = await smsOptinStorage.updateSmsOptinByPublicToken(token, updateData);
      
      if (!updated) {
        return res.status(404).json({ message: "Opt-in record not found" });
      }
      
      res.json({
        phoneNumber: updated.phoneNumber.replace(/(\+\d{1})\d{6}(\d{4})/, '$1******$2'),
        optin: updated.optin,
        success: true,
      });
    } catch (error) {
      console.error("Failed to update public opt-in:", error);
      res.status(500).json({ message: "Failed to update opt-in status" });
    }
  });
}
