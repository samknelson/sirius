import { z } from "zod";
import { registerWizardPlugin } from "../registry";
import type { WizardPlugin, WizardStepContext } from "../types";
import {
  checkClerkConflict,
  provisionClerkAccount,
} from "../../../services/clerk-provisioning";
import { logger } from "../../../logger";

const SERVICE = "employer-onboarding-plugin";

/**
 * Shape of the collected wizard data, validated before the employer is
 * created. Mirrors the fields the form steps write into `wizard.data`.
 */
const processSchema = z.object({
  employerName: z.string().min(1),
  typeId: z.string().uuid().nullable().optional(),
  industryId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional().default(true),
  benefitIds: z.array(z.string().uuid()).optional().default([]),
  ledgerAccountIds: z.array(z.string().uuid()).optional().default([]),
  contacts: z
    .array(
      z.object({
        firstName: z.string().optional().nullable(),
        lastName: z.string().optional().nullable(),
        email: z.string().email(),
        phone: z.string().optional().nullable(),
        contactTypeId: z.string().uuid().optional().nullable(),
        promoteToUser: z.boolean().optional().default(false),
      }),
    )
    .optional()
    .default([]),
});

interface OnboardingResults {
  employer: { id: string; name: string; siriusId?: string | null } | null;
  contacts: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
  ledgerLinks: Array<Record<string, unknown>>;
  errors: Array<Record<string, unknown>>;
}

/**
 * Create the employer + its contacts, phones, promoted user accounts, and
 * ledger links from the data collected across the earlier steps. Ported
 * verbatim from the retired bespoke
 * `POST /api/wizards/:id/employer-onboarding/process` route so the fixed
 * dispatcher `run` step drives it — zero wizard-specific routes. All DB
 * access is via `ctx.storage`; Clerk provisioning stays a plain service
 * call.
 */
async function createEmployerFromWizard(
  ctx: WizardStepContext,
): Promise<OnboardingResults> {
  const storage = ctx.storage;
  const wizardData = (ctx.wizard.data as any) || {};

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
    throw new Error("Invalid wizard data for processing");
  }

  const data = parsed.data;
  const results: OnboardingResults = {
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
  results.employer = {
    id: employer.id,
    name: employer.name,
    siriusId: employer.siriusId,
  };

  for (const contactData of data.contacts) {
    try {
      const contact = await storage.contacts.createContact({
        displayName:
          [contactData.firstName, contactData.lastName].filter(Boolean).join(" ") ||
          contactData.email,
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
            type: "phone_creation",
            email: contactData.email,
            message: phoneErr.message || "Failed to save phone number",
          });
        }
      }

      const contactInfo: any = {
        employerContactId: employerContact.id,
        contactId: contact.id,
        email: contactData.email,
        phone: contactData.phone || null,
        name: `${contactData.firstName || ""} ${contactData.lastName || ""}`.trim(),
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
                type: "user_promotion",
                email: contactData.email,
                message: "Email already associated with another Clerk account",
              });
            } else {
              user = await storage.users.createUser({
                email: contactData.email,
                firstName: contactData.firstName || null,
                lastName: contactData.lastName || null,
                isActive: true,
                accountStatus: "active",
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
            const employerRole = await storage.users.getRoleByName("employer");
            if (employerRole) {
              const currentRoles = await storage.users.getUserRoles(user.id);
              if (!currentRoles.some((r) => r.id === employerRole.id)) {
                await storage.users.assignRoleToUser({
                  userId: user.id,
                  roleId: employerRole.id,
                });
              }
            }

            const requiredVariable = await storage.variables.getByName(
              "employer_user_roles_required",
            );
            const requiredRoleIds: string[] = (
              Array.isArray(requiredVariable?.value)
                ? requiredVariable.value
                : []
            ) as string[];
            const currentRoles = await storage.users.getUserRoles(user.id);
            const currentRoleIds = currentRoles.map((r) => r.id);
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
            type: "user_promotion",
            email: contactData.email,
            message: err.message || "Failed to promote contact to user",
          });
        }
      }

      results.contacts.push(contactInfo);
    } catch (err: any) {
      results.errors.push({
        type: "contact_creation",
        email: contactData.email,
        message: err.message || "Failed to create contact",
      });
    }
  }

  for (const accountId of data.ledgerAccountIds) {
    try {
      const ea = await storage.ledger.ea.getOrCreate(
        "employer",
        employer.id,
        accountId,
      );
      results.ledgerLinks.push({ eaId: ea.id, accountId });
    } catch (err: any) {
      results.errors.push({
        type: "ledger_link",
        accountId,
        message: err.message || "Failed to create ledger link",
      });
    }
  }

  return results;
}

/**
 * Employer onboarding, in a box. Collect the employer name, attributes,
 * and contacts (dispatcher `submit` steps), then a `run` step creates the
 * employer + contacts + promoted users + ledger links, and finally a
 * read-only review. The initial-worker-load hand-off spawns a child
 * `gbhet_legal_workers_monthly` wizard via the generic create route — the
 * `worker_load` step also accepts a `submit` that records the child
 * wizard id, so nothing here needs a wizard-specific route. Plugin-level
 * `staff` gating preserves the one explicit gate the legacy process route
 * declared.
 */
export const employerOnboardingPlugin: WizardPlugin = {
  id: "employer_onboarding",
  name: "Employer Onboarding",
  description:
    "Create and configure a new employer with contacts, benefits, and initial worker load",
  requiredPolicy: "staff",
  category: "onboarding",
  steps: [
    {
      id: "employer_name",
      name: "Employer Name",
      description: "Enter the employer name",
      kind: "custom",
      component: "EmployerNameStep",
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        if (data.employerName?.trim()) return "completed";
        return wizard.currentStep === "employer_name"
          ? "in_progress"
          : "pending";
      },
      submit: (ctx: WizardStepContext) => {
        const input = ctx.input as { employerName?: string };
        const name = (input.employerName ?? "").trim();
        return { data: { employerName: name } };
      },
    },
    {
      id: "attributes",
      name: "Attributes",
      description: "Set employer type, industry, and benefit funds",
      kind: "custom",
      component: "AttributesStep",
      getState: () => "completed",
      submit: (ctx: WizardStepContext) => {
        const input = ctx.input as {
          typeId?: string | null;
          industryId?: string | null;
          benefitIds?: string[];
          ledgerAccountIds?: string[];
        };
        return {
          data: {
            typeId: input.typeId ?? null,
            industryId: input.industryId ?? null,
            benefitIds: input.benefitIds ?? [],
            ledgerAccountIds: input.ledgerAccountIds ?? [],
          },
        };
      },
    },
    {
      id: "contacts",
      name: "Contacts",
      description: "Add employer contacts and optionally promote to users",
      kind: "custom",
      component: "ContactsStep",
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        const contacts: any[] = data.contacts || [];
        if (contacts.length === 0) return "completed";
        return contacts.every((c) => c.email?.trim())
          ? "completed"
          : "in_progress";
      },
      submit: (ctx: WizardStepContext) => {
        const input = ctx.input as { contacts?: unknown[] };
        return { data: { contacts: input.contacts ?? [] } };
      },
    },
    {
      id: "worker_load",
      name: "Worker Load",
      description:
        "Create the employer and load initial workers via GBHET Legal wizard",
      kind: "run",
      component: "WorkerLoadStep",
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        if (data.employerId) return "completed";
        return wizard.currentStep === "worker_load"
          ? "in_progress"
          : "pending";
      },
      // Record the spawned child worker-import wizard id without a
      // wizard-specific route. The child wizard itself is created through
      // the generic create route.
      submit: (ctx: WizardStepContext) => {
        const input = ctx.input as { childWizardId?: string };
        if (!input.childWizardId) {
          throw new Error("childWizardId is required");
        }
        return { data: { childWizardId: input.childWizardId } };
      },
      run: async (ctx: WizardStepContext) => {
        const wizardData = (ctx.wizard.data as any) || {};
        // Idempotent: the employer is only ever created once.
        if (wizardData.employerId) {
          return { data: {} };
        }
        const results = await createEmployerFromWizard(ctx);
        logger.info("Employer onboarding processed", {
          service: SERVICE,
          wizardId: ctx.wizardId,
          employerId: results.employer?.id,
          errors: results.errors.length,
        });
        return {
          data: {
            employerId: results.employer?.id,
            processingResults: results,
          },
        };
      },
    },
    {
      id: "review",
      name: "Review",
      description: "Review everything created during onboarding",
      kind: "custom",
      component: "OnboardingReviewStep",
      getState: () => "completed",
    },
  ],
};

registerWizardPlugin(employerOnboardingPlugin);
