import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireComponent } from "../components";
import { addDaysYmd, getTodayYmd } from "@shared/utils/date";
import { checkFlood, recordFloodEvent } from "../../flood/service";
import { EDLS_SCHEDULE_ANSWER_FLOOD_EVENT } from "../../flood/events";
import { logger } from "../../logger";
import type { AssignmentForWorker } from "../../storage/edls/assignments";

/**
 * Sheet statuses a worker may see on the public schedule page. Draft/request
 * sheets are still being built and `trash` sheets are cancelled, so none of
 * them are anybody's schedule yet.
 */
const PUBLIC_SHEET_STATUSES = ["lock", "reserved"];

/** Number of calendar days shown, counting today. */
const SCHEDULE_DAYS = 7;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PublicWorkerSchedule {
  workerName: string;
  startYmd: string;
  endYmd: string;
  assignments: AssignmentForWorker[];
}

/** Family-name-first display, e.g. "Banales, Gabriel". */
function formatWorkerName(
  contact: { given: string | null; family: string | null; displayName: string } | undefined,
): string {
  if (!contact) return "";
  if (contact.family && contact.given) return `${contact.family}, ${contact.given}`;
  return contact.family || contact.given || contact.displayName || "";
}

/**
 * Resolve the `:id` in the URL to the worker whose schedule it addresses.
 *
 * The id is the worker's ACCESS TOKEN (`worker.aat`): a value minted purely
 * to be followed from a link, shown on no other screen, and regenerable — so
 * a link that has escaped can be revoked, and revoking costs the worker
 * nothing but their next text. It is deliberately NOT the worker id, which
 * appears in staff URLs and exports and can never be rotated: anyone who had
 * ever seen one would hold perpetual read access to that person's schedule.
 */
async function resolveScheduleWorkerId(id: string): Promise<string | null> {
  const token = await storage.workerAat.getByAccessUuid(id);
  return token?.workerId ?? null;
}

/**
 * The window the page shows, resolved once so the read and the answer
 * endpoint agree on it: an assignment the page would not show is not one the
 * link may answer for.
 */
function scheduleWindow(): { startYmd: string; endYmd: string } {
  const startYmd = getTodayYmd();
  return { startYmd, endYmd: addDaysYmd(startYmd, SCHEDULE_DAYS - 1) };
}

/**
 * The credential holder's assignments, exactly as the page lists them.
 * Resolving the credential and the visible assignments in one place is what
 * makes "an assignment the page would show" a fact rather than a second,
 * drifting rule.
 */
async function resolveVisibleAssignments(
  id: string,
): Promise<{ workerId: string; assignments: AssignmentForWorker[] } | null> {
  if (!UUID_REGEX.test(id)) return null;

  const workerId = await resolveScheduleWorkerId(id);
  if (!workerId) return null;

  if (!(await storage.workerEdls.hasEdlsPresence(workerId))) return null;

  const { startYmd, endYmd } = scheduleWindow();
  const assignments = await storage.edlsAssignments.getAssignmentsForWorker(
    workerId,
    { startYmd, endYmd, sheetStatuses: PUBLIC_SHEET_STATUSES },
  );
  return { workerId, assignments };
}

const answerSchema = z.object({
  accepted: z.boolean(),
});

export function registerEdlsPublicScheduleRoutes(app: Express) {
  const edlsComponent = requireComponent("edls");
  const aatComponent = requireComponent("worker.aat");

  /**
   * Public (unauthenticated) EDLS worker schedule.
   *
   * Holding the worker's AAT access token is the credential: anyone with the
   * link sees that worker's next seven days. Every rejection — malformed id,
   * unknown id, worker with no EDLS presence, contact gone — answers with the
   * same generic access-denied body so the endpoint never confirms whether a
   * given id exists.
   *
   * The token is independent of the worker id — which appears in staff URLs
   * and exports — and can be manually rotated. The access it grants is
   * deliberately the same public-link access that a worker uses from their
   * text, rather than a substitute sign-in flow.
   *
   * Gated on `worker.aat` as well as `edls`: the credential this page is
   * addressed by belongs to that component, so with it switched off there is no
   * such thing as a valid link here and the page is unreachable rather than
   * silently falling back to some other id.
   */
  app.get(
    "/api/public/edls/schedule/:id",
    edlsComponent,
    aatComponent,
    async (req: Request, res: Response) => {
      const denied = () => res.status(403).json({ message: "Access denied" });

      try {
        const { id } = req.params;
        const resolved = await resolveVisibleAssignments(id);
        if (!resolved) {
          denied();
          return;
        }

        const worker = await storage.workers.getWorker(resolved.workerId);
        if (!worker) {
          denied();
          return;
        }
        const contact = await storage.contacts.getContact(worker.contactId);

        const { startYmd, endYmd } = scheduleWindow();
        const payload: PublicWorkerSchedule = {
          workerName: formatWorkerName(contact),
          startYmd,
          endYmd,
          assignments: resolved.assignments,
        };
        res.json(payload);
      } catch (error) {
        console.error("Failed to fetch public EDLS schedule:", error);
        res.status(500).json({ message: "Failed to fetch schedule" });
      }
    },
  );

  /**
   * The worker's own answer to one of their assignments: accept or decline,
   * once.
   *
   * Every refusal — malformed or unknown credential, an assignment belonging
   * to somebody else, one outside the week the page shows, one already
   * answered — is the SAME generic access-denied body the read endpoint
   * uses, so the endpoint never confirms which of those it was and cannot be
   * used to probe for assignment ids.
   *
   * The AAT access token is the schedule-link credential and grants this
   * answer ability as well as the public read. It remains usable until it is
   * manually rotated; that trade-off is intentional for the AAT-based worker
   * access flow.
   *
   * The assignment must be one this credential's own page would show, and the
   * answer is recorded at most once, conditionally, in the storage write.
   */
  app.post(
    "/api/public/edls/schedule/:id/assignments/:assignmentId/answer",
    edlsComponent,
    aatComponent,
    async (req: Request, res: Response) => {
      const denied = () => res.status(403).json({ message: "Access denied" });

      try {
        const { id, assignmentId } = req.params;

        // Throttling infrastructure must never swallow a legitimate answer,
        // so a failing check/record lets the request through.
        const floodContext = { scheduleId: id, ip: req.ip || "unknown" };
        try {
          const flood = await checkFlood(EDLS_SCHEDULE_ANSWER_FLOOD_EVENT, floodContext);
          await recordFloodEvent(EDLS_SCHEDULE_ANSWER_FLOOD_EVENT, floodContext);
          if (!flood.allowed) {
            res.status(429).json({ message: "Too many attempts. Please try again later." });
            return;
          }
        } catch (floodError) {
          logger.warn("EDLS schedule answer flood check failed; allowing the answer", {
            service: "edls-public-schedule",
            error: floodError instanceof Error ? floodError.message : String(floodError),
          });
        }

        const parsed = answerSchema.safeParse(req.body);
        if (!parsed.success) {
          denied();
          return;
        }

        if (!UUID_REGEX.test(assignmentId)) {
          denied();
          return;
        }

        const resolved = await resolveVisibleAssignments(id);
        if (!resolved) {
          denied();
          return;
        }

        // Belonging to this worker AND being on the page are the same check:
        // the list is this credential's visible assignments and nothing else.
        const assignment = resolved.assignments.find((a) => a.assignmentId === assignmentId);
        if (!assignment) {
          denied();
          return;
        }

        // The storage write is the real one-answer guard (its condition is
        // part of the UPDATE); this only saves a pointless write on the
        // common stale-tab case.
        if (assignment.accepted !== null) {
          denied();
          return;
        }

        const recorded = await storage.edlsAssignments.setAccepted(assignmentId, parsed.data.accepted);
        if (!recorded) {
          denied();
          return;
        }

        res.json({ assignmentId, accepted: parsed.data.accepted });
      } catch (error) {
        console.error("Failed to record EDLS schedule answer:", error);
        res.status(500).json({ message: "Failed to record answer" });
      }
    },
  );
}
