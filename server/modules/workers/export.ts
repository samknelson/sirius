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
): Record<string, string> {
  const row: Record<string, string> = {
    "First Name": worker.given || "",
    "Middle Name": worker.middle || "",
    "Last Name": worker.family || "",
    SSN: formatSSN(worker.ssn),
  };

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
): string[] {
  return [
    "First Name",
    "Middle Name",
    "Last Name",
    "SSN",
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
  app.get(
    "/api/workers/export",
    requireAuth,
    requirePermission("staff"),
    async (req, res) => {
      let streamingStarted = false;
      let clientDisconnected = false;
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

        const accepted = res.write(chunk);
        if (accepted) return true;

        return await new Promise<boolean>((resolve, reject) => {
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

          res.once("drain", onDrain);
          res.once("close", onClose);
          res.once("error", onError);
          if (clientDisconnected || res.destroyed) finish(false);
        });
      };

      try {
        const nameIdSearch =
          typeof req.query.nameIdSearch === "string"
            ? req.query.nameIdSearch
            : undefined;
        const contactSearch =
          typeof req.query.contactSearch === "string"
            ? req.query.contactSearch
            : undefined;
        const sortOrder =
          req.query.sortOrder === "desc" ? "desc" : "asc";
        const validSortByValues = ["lastName", "firstName", "employer"] as const;
        const sortByParam =
          typeof req.query.sortBy === "string" ? req.query.sortBy : "";
        const sortBy = (validSortByValues as readonly string[]).includes(
          sortByParam,
        )
          ? (sortByParam as (typeof validSortByValues)[number])
          : "lastName";

        const employerId =
          typeof req.query.employerId === "string" &&
          req.query.employerId !== "all"
            ? req.query.employerId
            : undefined;
        const employerTypeId =
          typeof req.query.employerTypeId === "string" &&
          req.query.employerTypeId !== "all"
            ? req.query.employerTypeId
            : undefined;
        const bargainingUnitId =
          typeof req.query.bargainingUnitId === "string" &&
          req.query.bargainingUnitId !== "all"
            ? req.query.bargainingUnitId
            : undefined;
        const benefitId =
          typeof req.query.benefitId === "string" &&
          req.query.benefitId !== "all"
            ? req.query.benefitId
            : undefined;
        const hasMultipleEmployers = req.query.hasMultipleEmployers === "true";
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
          typeof req.query.contactStatus === "string"
            ? req.query.contactStatus
            : "";
        const contactStatus = validContactStatuses.includes(contactStatusParam)
          ? (contactStatusParam as WorkersExportParams["contactStatus"])
          : "all";
        const jobTitle =
          typeof req.query.jobTitle === "string" &&
          req.query.jobTitle.trim()
            ? req.query.jobTitle.trim()
            : undefined;
        const memberStatusId =
          typeof req.query.memberStatusId === "string" &&
          req.query.memberStatusId !== "all"
            ? req.query.memberStatusId
            : undefined;
        const representativeId =
          typeof req.query.representativeId === "string" &&
          req.query.representativeId !== "all"
            ? req.query.representativeId
            : undefined;
        const includeBenefits = req.query.includeBenefits === "true";
        // Validate before reading export metadata or sending CSV headers. An
        // invalid filter is a client error, not a failed or partial export.
        const roleFilters = normalizeWorkerBenefitRoleFilters(
          req.query,
          isCacheInitialized() && isComponentEnabledSync("trust.benefits"),
        );

        // These labels define the CSV shape and are read once. Per-worker
        // enrichment is intentionally done below for only the current batch.
        const [showOnListsTypes, memberStatusOptions] = await Promise.all([
          dependencies.workerIds.getShowOnListsIdTypes(),
          dependencies.getMemberStatusOptions(),
        ]);
        const memberStatusNameMap = new Map<string, string>(
          memberStatusOptions.map((option) => [option.id, option.name]),
        );
        const columns = buildColumns(showOnListsTypes, includeBenefits);

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

        let offset = 0;
        while (!clientDisconnected && !res.destroyed) {
          const workers = await dependencies.workers.getWorkersForExportBatch(
            {
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
            offset,
            EXPORT_BATCH_SIZE,
          );

          if (clientDisconnected || res.destroyed) return;
          if (workers.length === 0) break;

          const workerIdsList = workers.map((worker) => worker.id);
          const employerIds = [
            ...new Set(
              workers.flatMap(
                (worker) =>
                  ((worker as any).denorm_employer_ids as string[] | null) ||
                  [],
              ),
            ),
          ];
          const [workerIdRecords, employerRecords] = await Promise.all([
            dependencies.workerIds.getWorkerIdsForListByWorkerIds(
              workerIdsList,
              showOnListsTypes,
            ),
            dependencies.employers.getByIds(employerIds),
          ]);

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
          const csvRows = workers.map((worker) =>
            workerToCsvRow(
              worker,
              showOnListsTypes,
              workerIdMap,
              employerNameMap,
              memberStatusNameMap,
              includeBenefits,
            ),
          );

          if (!(await writeChunk(stringify(csvRows, { header: false, columns })))) {
            return;
          }
          offset += workers.length;
          // A short batch proves that no further matching rows exist. An exact
          // multiple makes one final empty, bounded read, which avoids a count
          // query and keeps the export reader independent of total-result state.
          if (workers.length < EXPORT_BATCH_SIZE) break;
        }

        if (!clientDisconnected && !res.destroyed) res.end();
      } catch (error) {
        if (error instanceof WorkerBenefitRoleFilterError) {
          return res.status(400).json({ message: error.message });
        }
        console.error("Failed to export workers:", error);
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
    },
  );
}