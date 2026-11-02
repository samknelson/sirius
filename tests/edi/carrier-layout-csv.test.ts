import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "csv-parse/sync";
import { registeredEdiPlugins, uniformRow } from "./fixtures/harness";
import { assembleEdiFileLines } from "../../server/plugins/trust/provider-edi/base";
import { carrierLayoutCsv } from "../../server/plugins/trust/provider-edi/carrier-csv";
import type { TrustProviderEdiContext } from "../../server/plugins/trust/provider-edi/registry";
import { kaiserEncodeNumber } from "../../server/plugins/trust/provider-edi/plugins/sitespecific-bao-kaiser";

const ctx = { input: { asOfDate: "2026-10-01" }, configData: {} } as TrustProviderEdiContext;
const csv = (text: string): string[][] => parse(text, { relax_column_count: true, skip_empty_lines: false });
afterEach(() => vi.useRealTimers());

describe("carrier QA exports for every registered serializer", () => {
  for (const plugin of registeredEdiPlugins()) {
    for (const value of ["", "000123", 'Éva,"quoted"\r\nnext', "X".repeat(2400)]) {
      it(`${plugin.id} preserves every serialized cell for ${JSON.stringify(value.slice(0, 30))}`, () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-02T12:34:56Z"));
        const rows = [uniformRow(value), uniformRow("second")];
        const native = assembleEdiFileLines(plugin, rows, ctx);
        const qa = csv(carrierLayoutCsv(plugin, rows, ctx));
        const records = qa.filter(row => row[0].startsWith("QA-only record kind:"));
        expect(records).toHaveLength(native.length);
        for (let i = 0; i < native.length; i++) {
          const cells = records[i].slice(1);
          if (plugin.csvFields) {
            expect(cells).toEqual(native[i] === "" ? [] : csv(native[i])[0]);
          } else {
            expect(cells.join("")).toBe(native[i]);
          }
        }
        expect(assembleEdiFileLines(plugin, rows, ctx)).toEqual(native);
        const detailHeading = qa.find(row => row[0] === "QA-only field names: detail")!;
        expect(detailHeading.slice(1)).toEqual((plugin.csvFields ?? plugin.ediFields).map(f => f.name));
        expect(records.filter(row => row[0] === "QA-only record kind: detail")).toHaveLength(rows.length);
      });
    }
    it(`${plugin.id} exposes a layout even with no saved detail rows`, () => {
      const qa = csv(carrierLayoutCsv(plugin, [], ctx));
      expect(qa.some(row => row[0] === "QA-only field names: detail")).toBe(true);
      expect(qa.some(row => row[0] === "QA-only record kind: detail")).toBe(false);
    });
  }

  it("uses distinct file-header and trailer field labels, with padding intact", () => {
    const delta = registeredEdiPlugins().find(p => p.id.endsWith("-delta"))!;
    const qa = csv(carrierLayoutCsv(delta, [{ memberSsn: "000123456", clientGroupId: "PREVIEW-ONLY" }], ctx));
    expect(qa.find(row => row[0] === "QA-only field names: file header 1")?.slice(1, 4))
      .toEqual(["Record Type", "Group ID", "Division ID"]);
    expect(qa.find(row => row[0] === "QA-only field names: file trailer 1")?.slice(1))
      .toEqual(["Record Type", "Record Count", "Filler"]);
    expect(qa.find(row => row[0] === "QA-only record kind: file trailer 1")?.slice(1, 3)).toEqual(["90", "3      "]);
    expect(qa.flat()).not.toContain("PREVIEW-ONLY");
  });

  it("preserves Kaiser overpunch and spaces rather than converting to numbers", () => {
    const kaiser = registeredEdiPlugins().find(p => p.id.endsWith("-kaiser"))!;
    const qa = csv(carrierLayoutCsv(kaiser, [{ duesAmount: kaiserEncodeNumber(-12.34) }], ctx));
    const heading = qa.find(row => row[0] === "QA-only field names: detail")!;
    const record = qa.find(row => row[0] === "QA-only record kind: detail")!;
    expect(record[heading.indexOf("Current Dues Amount")]).toBe("000123M");
    expect(record[heading.indexOf("FILLER1")]).toBe(" ".repeat(36));
  });

  it("keeps Local 11 and Carelon header suppression, and Dentwell's preamble and counts", () => {
    for (const suffix of ["local11", "carelon"]) {
      const plugin = registeredEdiPlugins().find(p => p.id.endsWith(`-${suffix}`))!;
      expect(carrierLayoutCsv(plugin, [uniformRow("0001")], ctx)).not.toContain("QA-only record kind: transmitted column header");
    }
    const dentwell = registeredEdiPlugins().find(p => p.id.endsWith("-dentwell"))!;
    const qa = csv(carrierLayoutCsv(dentwell, [{ memberType: "SUB" }, { memberType: "DEP" }], ctx));
    const records = qa.filter(row => row[0].startsWith("QA-only record kind:"));
    expect(records.map(row => row[0])).toEqual([
      "QA-only record kind: file header 1", "QA-only record kind: file header 2",
      "QA-only record kind: file header 3", "QA-only record kind: transmitted column header",
      "QA-only record kind: detail", "QA-only record kind: detail", "QA-only record kind: file trailer 1",
    ]);
    expect(records.at(-1)?.slice(1)).toEqual(["T", "1", "1"]);
  });

  it("refuses missing or inconsistent layouts rather than guessing from preview columns", () => {
    const plugin = registeredEdiPlugins().find(p => p.id.endsWith("-delta"))!;
    expect(() => carrierLayoutCsv({ ...plugin, fileHeaderLayouts: [] }, [], ctx)).toThrow("layouts are missing");
    expect(() => carrierLayoutCsv({ ...plugin, encodeRow: () => "short" }, [{}], ctx)).toThrow("width does not match");
  });
});
