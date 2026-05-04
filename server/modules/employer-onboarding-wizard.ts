import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { checkClerkConflict, provisionClerkAccount } from "../services/clerk-provisioning";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const processSchema = z.object({
  employerName: z.string().min(1),
  typeId: z.string().uuid().nullable().optional(),
  industryId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional().default(true),
  benefitIds: z.array(z.string().uuid()).optional().default([]),
  ledgerAccountIds: z.array(z.string().uuid()).optional().default([]),
  contacts: z.array(z.object({
    firstName: z.string().optional().nullable(),
    lastName: z.string().optional().nullable(),
    email: z.string().email(),
    phone: z.string().optional().nullable(),
    contactTypeId: z.string().uuid().optional().nullable(),
    promoteToUser: z.boolean().optional().default(false),
  })).optional().default([]),
});

export function registerEmployerOnboardingWizardRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware
) {
  app.post("/api/wizards/:id/employer-onboarding/process", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { id } = req.params;

      const wizard = await storage.wizards.getById(id);
      if (!wizard) {
        return res.status(404).json({ message: "Wizard not found" });
      }
      if (wizard.type !== 'employer_onboarding') {
        return res.status(400).json({ message: "Wizard is not an employer onboarding wizard" });
      }

      const wizardData = (wizard.data || {}) as any;

      if (wizardData.employerId) {
        return res.json({
          message: "Employer already created",
          employerId: wizardData.employerId,
          results: wizardData.processingResults,
        });
      }

      const parsed = processSchema.safeParse({
        employerName: wizardData.employerName,
        typeId: wizardData.typeId,
        industryId: wizardData.industryId,
        isActive: wizardData.isActive ?? true,
        benefitIds: wizardData.benefitIds || [],
        ledgerAccountIds: wizardData.ledgerAccountIds || [],
        contacts: wizardData.contacts || [],
      });

      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid wizard data for processing",
          errors: parsed.error.errors,
        });
      }

      const data = parsed.data;
      const results: any = {
        employer: null,
        contacts: [],
        users: [],
        ledgerLinks: [],
        errors: [],
      };

      const employer = await storage.employers.createEmployer({
        name: data.employerName,
        typeId: data.typeId || null,
        industryId: data.industryId || null,
        isActive: data.isActive,
      });
      results.employer = { id: employer.id, name: employer.name, siriusId: employer.siriusId };

      for (const contactData of data.contacts) {
        try {
          const contact = await storage.contacts.createContact({
            given: contactData.firstName || null,
            family: contactData.lastName || null,
            email: contactData.email,
          });

          const employerContact = await storage.employerContacts.create({
            contactId: contact.id,
            employerId: employer.id,
            contactTypeId: contactData.contactTypeId || null,
          });

          if (contactData.phone) {
            try {
              await storage.contacts.phoneNumbers.createPhoneNumber({
                contactId: contact.id,
                phoneNumber: contactData.phone,
                isPrimary: true,
                isActive: true,
              });
            } catch (phoneErr: any) {
              results.errors.push({
                type: 'phone_creation',
                email: contactData.email,
                message: phoneErr.message || 'Failed to save phone number',
              });
            }
          }

          const contactInfo: any = {
            employerContactId: employerContact.id,
            contactId: contact.id,
            email: contactData.email,
            phone: contactData.phone || null,
            name: `${contactData.firstName || ''} ${contactData.lastName || ''}`.trim(),
            promoted: false,
            userId: null,
          };

          if (contactData.promoteToUser) {
            try {
              const clerkCheck = await checkClerkConflict(contactData.email);

              let user = await storage.users.getUserByEmail(contactData.email);

              if (!user) {
                if (clerkCheck.conflict) {
                  results.errors.push({
                    type: 'user_promotion',
                    email: contactData.email,
                    message: 'Email already associated with another Clerk account',
                  });
                } else {
                  user = await storage.users.createUser({
                    email: contactData.email,
                    firstName: contactData.firstName || null,
                    lastName: contactData.lastName || null,
                    isActive: true,
                    accountStatus: 'active',
                  });

                  await provisionClerkAccount({
                    userId: user.id,
                    email: contactData.email,
                    firstName: contactData.firstName || null,
                    lastName: contactData.lastName || null,
                    existingClerkUserId: clerkCheck.existingClerkUserId,
                  });
                }
              }

              if (user) {
                const employerRole = await storage.users.getRoleByName('employer');
                if (employerRole) {
                  const currentRoles = await storage.users.getUserRoles(user.id);
                  if (!currentRoles.some(r => r.id === employerRole.id)) {
                    await storage.users.assignRoleToUser({
                      userId: user.id,
                      roleId: employerRole.id,
                    });
                  }
                }

                const requiredVariable = await storage.variables.getByName('employer_user_roles_required');
                const requiredRoleIds: string[] = (Array.isArray(requiredVariable?.value) ? requiredVariable.value : []) as string[];
                const currentRoles = await storage.users.getUserRoles(user.id);
                const currentRoleIds = currentRoles.map(r => r.id);
                for (const roleId of requiredRoleIds) {
                  if (!currentRoleIds.includes(roleId)) {
                    await storage.users.assignRoleToUser({ userId: user.id, roleId });
                  }
                }

                contactInfo.promoted = true;
                contactInfo.userId = user.id;
                results.users.push({
                  id: user.id,
                  email: user.email,
                  firstName: user.firstName,
                  lastName: user.lastName,
                });
              }
            } catch (err: any) {
              results.errors.push({
                type: 'user_promotion',
                email: contactData.email,
                message: err.message || 'Failed to promote contact to user',
              });
            }
          }

          results.contacts.push(contactInfo);
        } catch (err: any) {
          results.errors.push({
            type: 'contact_creation',
            email: contactData.email,
            message: err.message || 'Failed to create contact',
          });
        }
      }

      for (const accountId of data.ledgerAccountIds) {
        try {
          const ea = await storage.ledger.ea.getOrCreate('employer', employer.id, accountId);
          results.ledgerLinks.push({
            eaId: ea.id,
            accountId,
          });
        } catch (err: any) {
          results.errors.push({
            type: 'ledger_link',
            accountId,
            message: err.message || 'Failed to create ledger link',
          });
        }
      }

      await storage.wizards.update(id, {
        data: {
          ...wizardData,
          employerId: employer.id,
          processingResults: results,
          progress: {
            ...(wizardData.progress || {}),
            worker_load: {
              status: 'employer_created',
              completedAt: new Date().toISOString(),
            },
          },
        },
      });

      res.json({
        message: "Employer onboarding processed successfully",
        employerId: employer.id,
        results,
      });
    } catch (error: any) {
      console.error("Error processing employer onboarding:", error);
      res.status(500).json({ message: error.message || "Failed to process employer onboarding" });
    }
  });
}
