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
 * Public (unauthenticated) EDLS worker schedule.
 *
 * Holding the worker's ACCESS TOKEN is the credential: anyone with the link
 * sees that worker's next seven days. Every rejection — malformed id, unknown
 * id, an id that is not a token, worker with no EDLS presence, contact gone —
 * answers with the same generic access-denied body so the endpoint never
 * confirms whether a given id exists.
 *
 * Holding a token is not on its own enough: the worker must have EDLS
 * presence. That refuses a token minted for some other purpose (which would
 * otherwise answer with that person's name), while leaving a worker who has
 * merely been taken off a sheet able to read their own week.
 *
 * Gated on `worker.aat` as well as `edls`: the credential this page is
 * addressed by belongs to that component, so with it switched off there is no
 * such thing as a valid link here and the page is unreachable rather than
 * silently falling back to some other id.
 */
export function registerEdlsPublicScheduleRoutes(app: Express) {
  const edlsComponent = requireComponent("edls");
  const aatComponent = requireComponent("worker.aat");

  app.get(
    "/api/public/edls/schedule/:id",
    edlsComponent,
    aatComponent,
    async (req: Request, res: Response) => {
      const denied = () => res.status(403).json({ message: "Access denied" });

      try {
        const { id } = req.params;
        if (!UUID_REGEX.test(id)) {
          denied();
          return;
        }

        const workerId = await resolveScheduleWorkerId(id);
        if (!workerId) {
          denied();
          return;
        }

        if (!(await storage.workerEdls.hasEdlsPresence(workerId))) {
          denied();
          return;
        }

        const worker = await storage.workers.getWorker(workerId);
        if (!worker) {
          denied();
          return;
        }
        const contact = await storage.contacts.getContact(worker.contactId);

        const startYmd = getTodayYmd();
        const endYmd = addDaysYmd(startYmd, SCHEDULE_DAYS - 1);

        const assignments = await storage.edlsAssignments.getAssignmentsForWorker(
          workerId,
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
