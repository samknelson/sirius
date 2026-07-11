import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../components";
import { storage } from "../../storage";
import {
  createOpenEnrollmentWindowRequestSchema,
  updateOpenEnrollmentWindowRequestSchema,
} from "../../../shared/schema";

type AuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<any>;
type PermissionMiddleware = (
  permissionKey: string,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Admin CRUD for Open Enrollment windows plus a staff-readable "is a window
 * open right now" endpoint used to gate launching the Open Enrollment
 * wizard. Owned by the `trust.elections` component.
 */
export function registerOpenEnrollmentWindowsRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware,
) {
  const componentMiddleware = requireComponent("trust.elections");
  const windowsStorage = storage.openEnrollmentWindows;

  const ensureTable = async (res: Response): Promise<boolean> => {
    if (await windowsStorage.tableExists()) return true;
    res.status(503).json({
      message:
        "Open Enrollment windows are unavailable. Enable the Trust Elections component first.",
    });
    return false;
  };

  // ---- Active window (staff): drives the "start Open Enrollment" gate ----
  app.get(
    "/api/trust/open-enrollment-windows/active",
    requireAuth,
    requirePermission("staff"),
    componentMiddleware,
    async (_req, res) => {
      try {
        const today = todayYmd();
        const active = await windowsStorage.getActiveWindow(today);
        res.json({ active: active ?? null, today });
      } catch (error) {
        console.error("Failed to fetch active open enrollment window:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch active open enrollment window" });
      }
    },
  );

  // ---- List (staff) ----
  app.get(
    "/api/trust/open-enrollment-windows",
    requireAuth,
    requirePermission("staff"),
    componentMiddleware,
    async (_req, res) => {
      try {
        if (!(await ensureTable(res))) return;
        const records = await windowsStorage.getAll();
        res.json(records);
      } catch (error) {
        console.error("Failed to fetch open enrollment windows:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch open enrollment windows" });
      }
    },
  );

  // ---- Get one (staff) ----
  app.get(
    "/api/trust/open-enrollment-windows/:id",
    requireAuth,
    requirePermission("staff"),
    componentMiddleware,
    async (req, res) => {
      try {
        if (!(await ensureTable(res))) return;
        const record = await windowsStorage.get(req.params.id);
        if (!record) {
          res.status(404).json({ message: "Open enrollment window not found" });
          return;
        }
        res.json(record);
      } catch (error) {
        console.error("Failed to fetch open enrollment window:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch open enrollment window" });
      }
    },
  );

  // ---- Create (admin) ----
  app.post(
    "/api/trust/open-enrollment-windows",
    requireAuth,
    requirePermission("admin"),
    componentMiddleware,
    async (req, res) => {
      try {
        if (!(await ensureTable(res))) return;
        const parsed = createOpenEnrollmentWindowRequestSchema.safeParse(
          req.body,
        );
        if (!parsed.success) {
          res
            .status(400)
            .json({ message: "Invalid request", errors: parsed.error.issues });
          return;
        }
        const existing = await windowsStorage.getByPlanYear(parsed.data.planYear);
        if (existing) {
          res.status(409).json({
            message: `An Open Enrollment window already exists for plan year ${parsed.data.planYear}.`,
          });
          return;
        }
        const created = await windowsStorage.create({
          planYear: parsed.data.planYear,
          startYmd: parsed.data.startYmd,
          endYmd: parsed.data.endYmd,
          notes: parsed.data.notes ?? null,
          data: (parsed.data.data as any) ?? null,
        });
        res.status(201).json(created);
      } catch (error) {
        console.error("Failed to create open enrollment window:", error);
        res
          .status(500)
          .json({ message: "Failed to create open enrollment window" });
      }
    },
  );

  // ---- Update (admin) ----
  app.patch(
    "/api/trust/open-enrollment-windows/:id",
    requireAuth,
    requirePermission("admin"),
    componentMiddleware,
    async (req, res) => {
      try {
        if (!(await ensureTable(res))) return;
        const parsed = updateOpenEnrollmentWindowRequestSchema.safeParse(
          req.body,
        );
        if (!parsed.success) {
          res
            .status(400)
            .json({ message: "Invalid request", errors: parsed.error.issues });
          return;
        }
        const current = await windowsStorage.get(req.params.id);
        if (!current) {
          res.status(404).json({ message: "Open enrollment window not found" });
          return;
        }
        // Reject a plan-year change that would collide with another window.
        if (
          parsed.data.planYear !== undefined &&
          parsed.data.planYear !== current.planYear
        ) {
          const clash = await windowsStorage.getByPlanYear(parsed.data.planYear);
          if (clash && clash.id !== req.params.id) {
            res.status(409).json({
              message: `An Open Enrollment window already exists for plan year ${parsed.data.planYear}.`,
            });
            return;
          }
        }
        // Validate the resulting date range across mixed create/patch fields.
        const nextStart = parsed.data.startYmd ?? current.startYmd;
        const nextEnd = parsed.data.endYmd ?? current.endYmd;
        if (nextEnd < nextStart) {
          res.status(400).json({
            message: "End date must be on or after the start date",
          });
          return;
        }
        const patch: Record<string, unknown> = {};
        if (parsed.data.planYear !== undefined)
          patch.planYear = parsed.data.planYear;
        if (parsed.data.startYmd !== undefined)
          patch.startYmd = parsed.data.startYmd;
        if (parsed.data.endYmd !== undefined) patch.endYmd = parsed.data.endYmd;
        if (parsed.data.notes !== undefined)
          patch.notes = parsed.data.notes ?? null;
        if (parsed.data.data !== undefined) patch.data = parsed.data.data as any;
        const updated = await windowsStorage.update(req.params.id, patch as any);
        res.json(updated);
      } catch (error) {
        console.error("Failed to update open enrollment window:", error);
        res
          .status(500)
          .json({ message: "Failed to update open enrollment window" });
      }
    },
  );

  // ---- Delete (admin) ----
  app.delete(
    "/api/trust/open-enrollment-windows/:id",
    requireAuth,
    requirePermission("admin"),
    componentMiddleware,
    async (req, res) => {
      try {
        if (!(await ensureTable(res))) return;
        const ok = await windowsStorage.delete(req.params.id);
        if (!ok) {
          res.status(404).json({ message: "Open enrollment window not found" });
          return;
        }
        res.status(204).end();
      } catch (error) {
        console.error("Failed to delete open enrollment window:", error);
        res
          .status(500)
          .json({ message: "Failed to delete open enrollment window" });
      }
    },
  );
}
