import { describe, expect, it } from "vitest";

import { buildPassportExportEnvelope } from "../../server/modules/webservices/edls-passport-export-mapper";
import type { EdlsPassportExportPage } from "../../server/storage/edls/passport-export";

describe("passport export assignment worker IDs", () => {
  it("rejects an assignment whose worker Sirius ID is null", () => {
    const page: EdlsPassportExportPage = {
      total: 1,
      sheets: [
        {
          id: "sheet-1",
          title: "Scheduled Sheet",
          ymd: "2026-04-26",
          notes: null,
          changed: new Date("2026-04-26T12:00:00.000Z"),
          workerCount: 1,
          assignedCount: 1,
          employerName: null,
          departmentName: null,
          facilityName: null,
          jobGroupName: null,
          showStatusName: null,
          supervisorUser: null,
          creatorUser: null,
          latestSnapshotId: null,
          crews: [
            {
              id: "crew-1",
              title: "Crew",
              taskName: null,
              startTime: null,
              endTime: null,
              location: null,
              workerCount: 1,
              supervisorUser: null,
              crewleadSiriusId: null,
              assignments: [
                {
                  id: "assignment-1",
                  workerGiven: "Shell",
                  workerFamily: "Worker",
                  workerSiriusId: null,
                  memberStatusCode: null,
                  employeeId: null,
                  startTime: null,
                  note: null,
                  classificationName: null,
                },
              ],
            },
          ],
        },
      ],
    };

    expect(() => buildPassportExportEnvelope(page, { page: 0, limit: 50 })).toThrow(
      'Passport export cannot be generated: worker "Worker, Shell" (assignment-1) has no Sirius ID.',
    );
  });
});