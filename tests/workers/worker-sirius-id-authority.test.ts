import { describe, expect, it } from "vitest";
import { insertWorkerSchema, workers } from "../../shared/schema";
import {
  DEFAULT_WORKER_SIRIUS_ID_AUTHORITY,
  resolveWorkerSiriusIdAuthority,
  workerSiriusIdAuthoritySchema,
} from "../../shared/worker-sirius-id-authority";
import {
  workerSiriusIdDefaultFunctionSql,
  workerSiriusIdSequenceCreateSql,
  workerSiriusIdSequenceOwnershipSql,
} from "../../server/services/worker-sirius-id-default-sql";

describe("worker Sirius ID authority", () => {
  it("fails safe to external/S1 authority for missing or malformed controls", () => {
    expect(DEFAULT_WORKER_SIRIUS_ID_AUTHORITY).toBe("external");
    expect(resolveWorkerSiriusIdAuthority(undefined)).toBe("external");
    expect(resolveWorkerSiriusIdAuthority(null)).toBe("external");
    expect(resolveWorkerSiriusIdAuthority("unexpected")).toBe("external");
    expect(resolveWorkerSiriusIdAuthority({ authority: "s2" })).toBe("external");
    expect(workerSiriusIdAuthoritySchema.safeParse("unexpected").success).toBe(false);
  });

  it("permits local allocation only after the deliberate S2 cutover value", () => {
    expect(resolveWorkerSiriusIdAuthority("external")).toBe("external");
    expect(resolveWorkerSiriusIdAuthority("s2")).toBe("s2");
  });

  it("keeps the worker SID nullable and unique for UUID-only shells", () => {
    expect(workers.siriusId.notNull).toBe(false);
    expect(workers.siriusId.isUnique).toBe(true);
    // Imports preserve an exact source claim; shells deliberately send no SID.
    expect(insertWorkerSchema.safeParse({ siriusId: 1009069 }).success).toBe(true);
    expect(insertWorkerSchema.safeParse({ siriusId: null }).success).toBe(true);
  });

  it("has a policy-aware database default rather than an unconditional nextval", () => {
    expect(workerSiriusIdDefaultFunctionSql).toContain(
      "IF authority IS DISTINCT FROM 's2' THEN",
    );
    expect(workerSiriusIdDefaultFunctionSql).toContain("RETURN NULL;");
    expect(workerSiriusIdDefaultFunctionSql).toContain(
      "RETURN nextval(pg_get_serial_sequence('workers', 'sirius_id'))::integer;",
    );
    // The static variables query is intentionally dynamic: a missing
    // variables table fails rather than silently treating the policy as S2.
    expect(workerSiriusIdDefaultFunctionSql).toContain(
      "'SELECT value #>> ''{}'' FROM variables WHERE name = $1'",
    );
  });

  it("retains a serial-compatible, owned sequence for fresh and migrated allocation", () => {
    expect(workerSiriusIdSequenceCreateSql).toBe(
      "CREATE SEQUENCE IF NOT EXISTS workers_sirius_id_seq AS integer",
    );
    expect(workerSiriusIdSequenceOwnershipSql).toBe(
      "ALTER SEQUENCE workers_sirius_id_seq OWNED BY workers.sirius_id",
    );
  });
});