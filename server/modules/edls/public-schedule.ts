import type { Express, Request, Response } from "express";
import { storage } from "../../storage";
import { requireComponent } from "../components";
import { addDaysYmd, getTodayYmd } from "@shared/utils/date";
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
 * Public (unauthenticated) EDLS worker schedule.
 *
 * Knowing an `edls_assignments` row id IS the credential: anyone holding the
 * link sees that assignment's worker's next seven days. Every rejection —
 * malformed id, unknown id, worker/contact gone — answers with the same
 * generic access-denied body so the endpoint never confirms whether a given
 * id exists.
 */
export function registerEdlsPublicScheduleRoutes(app: Express) {
  const edlsComponent = requireComponent("edls");

  app.get(
    "/api/public/edls/schedule/:id",
    edlsComponent,
    async (req: Request, res: Response) => {
      const denied = () => res.status(403).json({ message: "Access denied" });

      try {
        const { id } = req.params;
        if (!UUID_REGEX.test(id)) {
          denied();
          return;
        }

        const assignment = await storage.edlsAssignments.get(id);
        if (!assignment) {
          denied();
          return;
        }

        const worker = await storage.workers.getWorker(assignment.workerId);
        if (!worker) {
          denied();
          return;
        }
        const contact = await storage.contacts.getContact(worker.contactId);

        const startYmd = getTodayYmd();
        const endYmd = addDaysYmd(startYmd, SCHEDULE_DAYS - 1);

        const assignments = await storage.edlsAssignments.getAssignmentsForWorker(
          assignment.workerId,
          { startYmd, endYmd, sheetStatuses: PUBLIC_SHEET_STATUSES },
        );

        const payload: PublicWorkerSchedule = {
          workerName: formatWorkerName(contact),
          startYmd,
          endYmd,
          assignments,
        };
        res.json(payload);
      } catch (error) {
        console.error("Failed to fetch public EDLS schedule:", error);
        res.status(500).json({ message: "Failed to fetch schedule" });
      }
    },
  );
}
