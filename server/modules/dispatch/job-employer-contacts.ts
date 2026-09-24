import type { Express } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireComponent } from "../components";

/**
 * Routes for the dispatch job "Employer Contacts" tab: associate contacts
 * from the job's employer with the job. Gated by the dispatch component and
 * the dispatch.job.employer.contacts policy (staff OR employer users linked
 * to the job's employer), so linked employer users can use them — NOT the
 * admin gate the other /api/dispatch-jobs routes use.
 *
 * The same-employer rule lives here, route-level only: on add, the contact
 * must currently be one of the job's employer's contacts. Existing
 * associations deliberately survive a contact later being removed from the
 * employer, and no cleanup happens on employer change.
 */
export function registerDispatchJobEmployerContactsRoutes(
  app: Express,
  requireAuth: any,
  requireAccess: any,
) {
  const dispatchComponent = requireComponent("dispatch");
  const jobAccess = requireAccess(
    "dispatch.job.employer.contacts",
    (req: any) => req.params.jobId,
  );

  const loadJob = async (jobId: string) => storage.dispatchJobs.getWithRelations(jobId);

  // Associations for a job, plus enough job header info for employer users
  // (who cannot fetch the staff-only /api/dispatch-jobs/:id endpoint).
  app.get(
    "/api/dispatch-jobs/:jobId/employer-contacts",
    requireAuth,
    dispatchComponent,
    jobAccess,
    async (req, res) => {
      try {
        const job = await loadJob(req.params.jobId);
        if (!job) return res.status(404).json({ message: "Dispatch job not found" });
        const associations = await storage.dispatchJobEmployerContacts.listByJob(job.id);
        res.json({
          job: {
            id: job.id,
            title: job.title,
            employerId: job.employerId,
            employerName: job.employer?.name ?? null,
          },
          associations,
        });
      } catch (error) {
        console.error("Failed to list dispatch job employer contacts:", error);
        res.status(500).json({ message: "Failed to fetch employer contacts for this job" });
      }
    },
  );

  // Candidate contacts = the job's employer's current contacts, served
  // job-scoped under the same policy so linked employer users can populate
  // the picker (the generic employer contacts endpoint has its own gating).
  app.get(
    "/api/dispatch-jobs/:jobId/employer-contacts/candidates",
    requireAuth,
    dispatchComponent,
    jobAccess,
    async (req, res) => {
      try {
        const job = await loadJob(req.params.jobId);
        if (!job) return res.status(404).json({ message: "Dispatch job not found" });
        const employerContacts = await storage.employerContacts.listByEmployer(job.employerId);
        res.json(
          employerContacts.map((ec) => ({
            contactId: ec.contactId,
            name: ec.contact?.displayName ?? "Unknown",
            email: ec.contact?.email ?? null,
            contactType: ec.contactType?.name ?? null,
          })),
        );
      } catch (error) {
        console.error("Failed to list employer contact candidates:", error);
        res.status(500).json({ message: "Failed to fetch the employer's contacts" });
      }
    },
  );

  app.post(
    "/api/dispatch-jobs/:jobId/employer-contacts",
    requireAuth,
    dispatchComponent,
    jobAccess,
    async (req, res) => {
      try {
        const job = await loadJob(req.params.jobId);
        if (!job) return res.status(404).json({ message: "Dispatch job not found" });

        const parsed = z.object({ contactId: z.string().min(1) }).strict().safeParse(req.body);
        if (!parsed.success) {
          return res
            .status(400)
            .json({ message: "Invalid request body", errors: parsed.error.flatten() });
        }
        const { contactId } = parsed.data;

        // Business rule (route-level by design): the contact must currently
        // belong to the job's employer.
        const employerContacts = await storage.employerContacts.listByEmployer(job.employerId);
        if (!employerContacts.some((ec) => ec.contactId === contactId)) {
          return res.status(400).json({
            message: "This contact does not belong to the job's employer",
          });
        }

        const association = await storage.dispatchJobEmployerContacts.create(job.id, contactId);
        res.status(201).json(association);
      } catch (error: any) {
        if (error?.code === "23505") {
          return res
            .status(409)
            .json({ message: "This contact is already associated with the job" });
        }
        if (error?.code === "23503") {
          return res.status(400).json({ message: "Contact not found" });
        }
        console.error("Failed to associate employer contact with job:", error);
        res.status(500).json({ message: "Failed to add the contact to this job" });
      }
    },
  );

  app.delete(
    "/api/dispatch-jobs/:jobId/employer-contacts/:associationId",
    requireAuth,
    dispatchComponent,
    jobAccess,
    async (req, res) => {
      try {
        const job = await loadJob(req.params.jobId);
        if (!job) return res.status(404).json({ message: "Dispatch job not found" });

        // Scope the delete to THIS job: a valid association id belonging to
        // a different job must not be deletable through this job's grant.
        const existing = await storage.dispatchJobEmployerContacts.get(req.params.associationId);
        if (!existing || existing.jobId !== job.id) {
          return res.status(404).json({ message: "Association not found" });
        }
        await storage.dispatchJobEmployerContacts.delete(existing.id);
        res.status(204).send();
      } catch (error) {
        console.error("Failed to remove employer contact from job:", error);
        res.status(500).json({ message: "Failed to remove the contact from this job" });
      }
    },
  );
}
