import { describe, expect, it } from "vitest";
import { ALTERNATE_TAX_ID, classifyTaxIdentity, normalizeAlternateTaxId } from "../../shared/utils/worker-tax-identity";
import { findTaxIdentityConflicts, resolveTaxIdentity, type TaxIdentityReader } from "../../server/storage/workers/tax-identity";

const worker = { id: "worker", ssn: "123456789", contactId: "contact", siriusId: 1, bargainingUnitId: null, data: null };
function reader(): TaxIdentityReader {
  return {
    workers: {
      getWorker: async id => id === worker.id ? worker : undefined,
      getWorkerBySSN: async ssn => ssn === worker.ssn ? worker : undefined,
    },
    workerIds: { getWorkerIdByTypeAndValue: async (type, value) =>
      type === ALTERNATE_TAX_ID && value === "000123456" || type === "payroll" && value === "001"
        ? { workerId: worker.id } : undefined },
  };
}
describe("tax identifier classification and shared resolution", () => {
  it("keeps valid SSNs and the existing numeric leading-zero behaviour", () => {
    expect(classifyTaxIdentity("123-45-6789")).toEqual({ kind: "ssn", value: "123456789" });
    expect(classifyTaxIdentity("8620006")).toEqual({ kind: "ssn", value: "008620006" });
  });
  it("normalizes only numeric spaces/hyphens, never pads alternates or loses letters", () => {
    expect(normalizeAlternateTaxId(" 000-12-3456 ")).toBe("000123456");
    expect(normalizeAlternateTaxId("000 12 3456")).toBe("000123456");
    expect(normalizeAlternateTaxId("000.12.3456")).toBe("000123456");
    expect(classifyTaxIdentity("123.45.6789")).toEqual({ kind: "ssn", value: "123456789" });
    expect(normalizeAlternateTaxId("A001-23")).toBe("A001-23");
    expect(normalizeAlternateTaxId("a001-23")).toBe("a001-23");
    expect(normalizeAlternateTaxId("00012")).toBe("00012");
    expect(classifyTaxIdentity("A123456789").kind).toBe("alternate");
  });
  it.each(["", null, "N/A", "unknown", "not available", "000-00-0000", "111111111", "999-99-9999", "---", "XXXX", "0", "abc", "12!", -1, Infinity])(
    "requires correction for a missing, placeholder or unusable value", input => {
      expect(classifyTaxIdentity(input).kind).toBe("review");
      expect(() => normalizeAlternateTaxId(input)).toThrow();
    });
  it("matches alternates only by their type and keeps an existing valid SSN", async () => {
    const result = await resolveTaxIdentity(reader(), "000-12-3456");
    expect(result.worker).toEqual(worker);
    expect(result.identity.kind).toBe("alternate");
    expect((await resolveTaxIdentity(reader(), "000 12 3456")).worker?.id).toBe(worker.id);
    expect((await resolveTaxIdentity(reader(), "234567891")).worker).toBeUndefined();
    await expect(resolveTaxIdentity(reader(), "unknown")).rejects.toThrow("placeholder");
  });
  it("marks every conflicting duplicate row, regardless of order", async () => {
    for (const rows of [
      [{ ssn: "000123456", firstName: "One" }, { ssn: "000-12-3456", firstName: "Two" }],
      [{ ssn: "000-12-3456", firstName: "Two" }, { ssn: "000123456", firstName: "One" }],
    ]) expect((await findTaxIdentityConflicts(reader(), rows)).size).toBe(2);
  });
  it("detects payroll/tax disagreement before either processing order can claim it", async () => {
    const rows = [{ ssn: "900123456", personNumber: "001" }, { ssn: "900-12-3456", personNumber: "002" }];
    expect((await findTaxIdentityConflicts(reader(), rows, "payroll")).size).toBe(2);
    expect((await findTaxIdentityConflicts(reader(), rows.reverse(), "payroll")).size).toBe(2);
    const disagreement = await findTaxIdentityConflicts(reader(), [{ ssn: "234567891", personNumber: "001" }], "payroll");
    expect(disagreement.get(0)).toContain("disagree");
    expect((await findTaxIdentityConflicts(reader(), [{ ssn: "N/A", personNumber: "001" }], "payroll")).get(0)).toContain("placeholder");
  });
});
