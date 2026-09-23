import type { Express, RequestHandler } from "express";
import { stringify } from "csv-stringify/sync";
import type { EmployerStorage } from "../../storage/employers/employers";
import type {
  WorkerIdStorage,
  ShowOnListsIdType,
} from "../../storage/workers/ids";
import type {
  WorkerStorage,
  WorkerWithDetails,
  WorkersExportParams,
  WorkerExportCursor,
  WorkerExportBatch,
} from "../../storage/workers";
import { buildContentDisposition } from "../../utils/content-disposition";
import {
  isCacheInitialized,
  isComponentEnabledSync,
} from "../../services/component-cache";
import {
  normalizeWorkerBenefitRoleFilters,
  WorkerBenefitRoleFilterError,
} from "@shared/worker-benefit-role-filters";
import { parseWorkerSsnFilter, WorkerSsnFilterError } from "./ssn-filter";

export interface WorkerExportDependencies {
  workers: Pick<WorkerStorage, "getWorkersForExportBatch">;
  workerIds: Pick<
    WorkerIdStorage,
    "getShowOnListsIdTypes" | "getWorkerIdsForListByWorkerIds"
  >;
  employers: Pick<EmployerStorage, "getByIds">;
  getMemberStatusOptions: () => Promise<Array<{ id: string; name: string }>>;
}

const EXPORT_BATCH_SIZE = 250;
const EXPORT_STAGE_TIMEOUT_MS = 90_000;

function withExportTimeout<T>(
  promise: Promise<T>,
  stage: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => {
        onTimeout?.();
        reject(new Error(`Worker export ${stage} timed out`));
      },
      EXPORT_STAGE_TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function formatSSN(ssn: string | null): string {
  if (!ssn) return "";
  const digits = ssn.replace(/\D/g, "");
  if (digits.length === 9) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  }
  return ssn;
}

function workerToCsvRow(
  worker: WorkerWithDetails,
  showOnListsTypes: ShowOnListsIdType[],
  workerIdMap: Map<string, Map<string, string>>,
  employerNameMap: Map<string, string>,
  memberStatusNameMap: Map<string, string>,
  includeBenefits: boolean,
  includeSsn: boolean,
): Record<string, string> {
  const row: Record<string, string> = {
    "First Name": worker.given || "",
    "Middle Name": worker.middle || "",
    "Last Name": worker.family || "",
  };
  if (includeSsn) row.SSN = formatSSN(worker.ssn);

  for (const idType of showOnListsTypes) {
    row[idType.name] = workerIdMap.get(worker.id)?.get(idType.id) || "";
  }

  row["Job Title"] = worker.denorm_job_title || "";
  row["Bargaining Unit"] = (worker as any).bargaining_unit_name || "";

  const memberStatusIds: string[] = (worker as any).denorm_ms_ids || [];
  row["Member Status"] = memberStatusIds
    .map((id) => memberStatusNameMap.get(id))
    .filter((name): name is string => !!name)
    .join("; ");

  const employerIds: string[] = (worker as any).denorm_employer_ids || [];
  row["Employer(s)"] = employerIds
    .map((id) => employerNameMap.get(id))
    .filter((name): name is string => !!name)
    .join("; ");

  row.Street = worker.address_street || "";
  row.City = worker.address_city || "";
  row.State = worker.address_state || "";
  row["Postal Code"] = worker.address_postal_code || "";
  row.Country = worker.address_country || "";
  row.Email = worker.contact_email || "";
  row["Phone Number"] = worker.phone_number || "";

  if (includeBenefits) {
    row["Current Benefits"] = (worker.benefits || [])
      .filter((benefit: any) => benefit && benefit.name)
      .map((benefit: any) => benefit.name)
      .join("; ");
  }

  return row;
}

function buildColumns(
  showOnListsTypes: ShowOnListsIdType[],
  includeBenefits: boolean,
  includeSsn: boolean,
): string[] {
  return [
    "First Name",
    "Middle Name",
    "Last Name",
    ...(includeSsn ? ["SSN"] : []),
    ...showOnListsTypes.map((type) => type.name),
    "Job Title",
    "Bargaining Unit",
    "Member Status",
    "Employer(s)",
    "Street",
    "City",
    "State",
    "Postal Code",
    "Country",
    "Email",
    "Phone Number",
    ...(includeBenefits ? ["Current Benefits"] : []),
  ];
}

export function registerWorkerExportRoute(
  app: Express,
  requireAuth: RequestHandler,
  requirePermission: (permissionKey: string) => RequestHandler,
  dependencies: WorkerExportDependencies,
): void {
  const handler: RequestHandler = async (req, res) => {
      let streamingStarted = false;
      let clientDisconnected = false;
      const exportStartedAt = Date.now();
      let firstByteAt: number | undefined;
      let totalBytes = 0;
      const onClientClose = () => {
        // `close` also follows a normal `end`; writableEnded distinguishes
        // that case from a client that went away while the export was running.
        if (!res.writableEnded) clientDisconnected = true;
      };
      res.once("close", onClientClose);

      const writeChunk = async (chunk: string): Promise<boolean> => {
        if (clientDisconnected || res.destroyed || res.writableEnded) {
          return false;
        }

        const bytes = Buffer.byteLength(chunk);
        const accepted = res.write(chunk);
        totalBytes += bytes;
        firstByteAt ??= Date.now();
        if (accepted) return true;

        let cancelWait = () => {};
        return await withExportTimeout(new Promise<boolean>((resolve, reject) => {
          let settled = false;
          const cleanup = () => {
            res.removeListener("drain", onDrain);
            res.removeListener("close", onClose);
            res.removeListener("error", onError);
          };
          const finish = (value: boolean, error?: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (error) reject(error);
            else resolve(value);
          };
          const onDrain = () =>
            finish(!clientDisconnected && !res.destroyed);
          const onClose = () => {
            clientDisconnected = true;
            finish(false);
          };
          const onError = (error: Error) => finish(false, error);
          cancelWait = () => finish(false);

          res.once("drain", onDrain);
          res.once("close", onClose);
          res.once("error", onError);
          if (clientDisconnected || res.destroyed) finish(false);
        }), "response backpressure", cancelWait);
      };

      try {
        if (req.method === "GET" && ("ssn" in req.query || "ssnFilter" in req.query)) {
          return res.status(400).json({ message: "SSN filters require a secure request body" });
        }
        const query = req.method === "POST" ? req.body ?? {} : req.query;
        const ssnFilter = req.method === "POST" ? parseWorkerSsnFilter(query.ssn) : undefined;
        const nameIdSearch =
          typeof query.nameIdSearch === "string"
            ? query.nameIdSearch
            : undefined;
        const contactSearch =
          typeof query.contactSearch === "string"
            ? query.contactSearch
            : undefined;
        const sortOrder =
          query.sortOrder === "desc" ? "desc" : "asc";
        const validSortByValues = ["lastName", "firstName", "employer"] as const;
        const sortByParam =
          typeof query.sortBy === "string" ? query.sortBy : "";
        const sortBy = (validSortByValues as readonly string[]).includes(
          sortByParam,
        )
          ? (sortByParam as (typeof validSortByValues)[number])
          : "lastName";

        const employerId =
          typeof query.employerId === "string" &&
          query.employerId !== "all"
            ? query.employerId
            : undefined;
        const employerTypeId =
          typeof query.employerTypeId === "string" &&
          query.employerTypeId !== "all"
            ? query.employerTypeId
            : undefined;
        const bargainingUnitId =
          typeof query.bargainingUnitId === "string" &&
          query.bargainingUnitId !== "all"
            ? query.bargainingUnitId
            : undefined;
        const benefitId =
          typeof query.benefitId === "string" &&
          query.benefitId !== "all"
            ? query.benefitId
            : undefined;
        const hasMultipleEmployers = query.hasMultipleEmployers === "true" || query.hasMultipleEmployers === true;
        const validContactStatuses = [
          "all",
          "has_email",
          "missing_email",
          "has_phone",
          "missing_phone",
          "has_address",
          "missing_address",
          "complete",
          "incomplete",
        ];
        const contactStatusParam =
          typeof query.contactStatus === "string"
            ? query.contactStatus
            : "";
        const contactStatus = validContactStatuses.includes(contactStatusParam)
          ? (contactStatusParam as WorkersExportParams["contactStatus"])
          : "all";
        const jobTitle =
          typeof query.jobTitle === "string" &&
          query.jobTitle.trim()
            ? query.jobTitle.trim()
            : undefined;
        const memberStatusId =
          typeof query.memberStatusId === "string" &&
          query.memberStatusId !== "all"
            ? query.memberStatusId
            : undefined;
        const representativeId =
          typeof query.representativeId === "string" &&
          query.representativeId !== "all"
            ? query.representativeId
            : undefined;
        const includeBenefits = query.includeBenefits === "true" || query.includeBenefits === true;
        // Validate before reading export metadata or sending CSV headers. An
        // invalid filter is a client error, not a failed or partial export.
        const roleFilters = normalizeWorkerBenefitRoleFilters(
          query,
          isCacheInitialized() && isComponentEnabledSync("trust.benefits"),
        );

        // These labels define the CSV shape and are read once. Per-worker
        // enrichment is intentionally done below for only the current batch.
        const [showOnListsTypes, memberStatusOptions] = await withExportTimeout(
          Promise.all([
            dependencies.workerIds.getShowOnListsIdTypes(),
            dependencies.getMemberStatusOptions(),
          ]),
          "export metadata",
        );
        const memberStatusNameMap = new Map<string, string>(
          memberStatusOptions.map((option) => [option.id, option.name]),
        );
        const columns = buildColumns(showOnListsTypes, includeBenefits, !ssnFilter);

        const filename = `workers_export_${new Date()
          .toISOString()
          .split("T")[0]}.csv`;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          buildContentDisposition("attachment", filename),
        );
        // Flush headers and the CSV header before the first worker query. This
        // lets proxies see progress while the remaining batches are read.
        res.flushHeaders();
        streamingStarted = true;
        if (!(await writeChunk(stringify([], { header: true, columns })))) {
          return;
        }

        let cursor: WorkerExportCursor | null = null;
        let totalRows = 0;
        let batchNumber = 0;
        while (!clientDisconnected && !res.destroyed) {
          const batchStartedAt = Date.now();
          const readStartedAt = Date.now();
          const batch: WorkerExportBatch = await withExportTimeout(
            dependencies.workers.getWorkersForExportBatch(
            {
              ssnFilter,
              nameIdSearch,
              contactSearch,
              sortBy,
              sortOrder,
              employerId,
              employerTypeId,
              bargainingUnitId,
              hasMultipleEmployers,
              benefitId,
              contactStatus,
              jobTitle,
              memberStatusId,
              representativeId,
              includeBenefits,
              ...roleFilters,
            },
            cursor,
            EXPORT_BATCH_SIZE,
            ),
            "batch read",
          );
          const readMs = Date.now() - readStartedAt;
          const workers: WorkerWithDetails[] = batch.rows;

          if (clientDisconnected || res.destroyed) return;
          if (workers.length === 0) {
            cursor = batch.nextCursor;
            break;
          }

          const workerIdsList = workers.map((worker) => worker.id);
          const employerIds: string[] = [
            ...new Set(
              workers.flatMap(
                (worker: WorkerWithDetails) =>
                  ((worker as any).denorm_employer_ids as string[] | null) ||
                  [],
              ),
            ) as Set<string>,
          ];
          const enrichmentStartedAt = Date.now();
          const [workerIdRecords, employerRecords] = await withExportTimeout(
            Promise.all([
              dependencies.workerIds.getWorkerIdsForListByWorkerIds(
                workerIdsList,
                showOnListsTypes,
              ),
              dependencies.employers.getByIds(employerIds),
            ]),
            "batch enrichment",
          );
          const enrichmentMs = Date.now() - enrichmentStartedAt;

          const workerIdMap = new Map<string, Map<string, string>>();
          for (const workerIdRecord of workerIdRecords) {
            if (!workerIdMap.has(workerIdRecord.workerId)) {
              workerIdMap.set(workerIdRecord.workerId, new Map());
            }
            workerIdMap
              .get(workerIdRecord.workerId)!
              .set(workerIdRecord.typeId, workerIdRecord.value);
          }
          const employerNameMap = new Map(
            employerRecords.map((employer) => [employer.id, employer.name]),
          );
          const csvRows = workers.map((worker: WorkerWithDetails) =>
            workerToCsvRow(
              worker,
              showOnListsTypes,
              workerIdMap,
              employerNameMap,
              memberStatusNameMap,
              includeBenefits,
              !ssnFilter,
            ),
          );

          const csvChunk = stringify(csvRows, { header: false, columns });
          const writeStartedAt = Date.now();
          if (!(await writeChunk(csvChunk))) {
            return;
          }
          const writeMs = Date.now() - writeStartedAt;
          totalRows += workers.length;
          batchNumber += 1;
          cursor = batch.nextCursor;
          console.info("worker export batch", {
            batch: batchNumber,
            rows: workers.length,
            readMs,
            enrichmentMs,
            writeMs,
            durationMs: Date.now() - batchStartedAt,
            bytes: Buffer.byteLength(csvChunk),
          });
          if (!cursor) break;
        }

        if (!clientDisconnected && !res.destroyed) {
          const finished = new Promise<boolean>(resolve => {
            const onFinish = () => { cleanup(); resolve(true); };
            const onClose = () => { cleanup(); resolve(false); };
            const cleanup = () => {
              res.removeListener("finish", onFinish);
              res.removeListener("close", onClose);
            };
            res.once("finish", onFinish);
            res.once("close", onClose);
          });
          res.end();
          if (await withExportTimeout(finished, "response completion")) {
            console.info("worker export complete", {
              batches: batchNumber,
              rows: totalRows,
              bytes: totalBytes,
              firstByteMs: firstByteAt === undefined ? null : firstByteAt - exportStartedAt,
              durationMs: Date.now() - exportStartedAt,
            });
          }
        }
      } catch (error) {
        if (error instanceof WorkerBenefitRoleFilterError || error instanceof WorkerSsnFilterError) {
          return res.status(400).json({ message: error.message });
        }
        // SQL errors may carry prepared-statement parameters, including a
        // body-only SSN search. Never put the thrown object in export logs.
        console.error("Failed to export workers:", {
          method: req.method, stage: streamingStarted ? "stream" : "setup",
          type: error instanceof Error ? error.name : "unknown",
          durationMs: Date.now() - exportStartedAt,
        });
        if (streamingStarted || res.headersSent) {
          // Once CSV bytes have been sent, a JSON error would corrupt the
          // download and Express cannot safely send a second response.
          if (!res.destroyed) res.destroy();
        } else if (!res.headersSent) {
          res.status(500).json({ message: "Failed to export workers" });
        }
      } finally {
        res.removeListener("close", onClientClose);
      }
    };
  app.get("/api/workers/export", requireAuth, requirePermission("staff"), handler);
  app.post("/api/workers/export", requireAuth, requirePermission("staff"), requirePermission("workers.ssn"), handler);
}