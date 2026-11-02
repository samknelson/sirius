import { parse } from "csv-parse/sync";
import { csvEscape } from "./base";
import type { EdiOutputLayout, TrustProviderEdiContext, TrustProviderEdiPlugin } from "./registry";

/**
 * Decode the actual carrier serialization, never the preview or pre-format values.
 * QA-only heading rows identify each distinct layout; data stays in native order.
 */
export function carrierLayoutCsv(
  plugin: TrustProviderEdiPlugin,
  rows: ReadonlyArray<Record<string, unknown>>,
  ctx: TrustProviderEdiContext,
): string {
  const output: string[][] = [];
  const add = (kind: string, line: string, layout: EdiOutputLayout, heading = true) => {
    const names = layout.fields.map(f => f.name);
    let cells: string[];
    if (layout.format === "csv") {
      cells = line === "" && names.length === 0
        ? []
        : (parse(line, { relax_column_count: false, skip_empty_lines: false }) as string[][])[0] ?? [""];
      if (cells.length !== names.length) throw new Error(`Carrier ${kind} column count does not match its layout`);
    } else {
      let offset = 0;
      cells = layout.fields.map(field => {
        const cell = line.slice(offset, offset + field.width);
        offset += field.width;
        return cell;
      });
      if (offset !== line.length) throw new Error(`Carrier ${kind} width does not match its layout`);
    }
    if (heading) output.push([`QA-only field names: ${kind}`, ...names]);
    output.push([`QA-only record kind: ${kind}`, ...cells]);
  };
  const aggregates = { detailRecordCount: rows.length, detailRows: rows };
  const hook = (
    kind: string,
    value: string | string[] | null | undefined,
    layouts: readonly EdiOutputLayout[] | undefined,
  ) => {
    const lines = value == null ? [] : Array.isArray(value) ? value : [value];
    if (lines.length !== (layouts?.length ?? 0)) throw new Error(`Carrier ${kind} layouts are missing`);
    lines.forEach((line, index) => add(`${kind} ${index + 1}`, line, layouts![index]));
  };
  hook("file header", plugin.encodeFileHeader?.(ctx, aggregates), plugin.fileHeaderLayouts);
  const detail: EdiOutputLayout = plugin.csvFields
    ? { format: "csv", fields: plugin.csvFields }
    : { format: "fixed-width", fields: plugin.ediFields };
  if (!detail.fields.length) throw new Error("Carrier detail layout is missing");
  if (plugin.outputFormat === "csv" && plugin.csvIncludeHeaderRow !== false) {
    const header = plugin.encodeCsvHeaderRow?.(ctx);
    if (header == null) throw new Error("Carrier CSV header is missing");
    add("transmitted column header", header, detail);
  }
  // One QA heading for the detail population (also present for an empty run).
  output.push(["QA-only field names: detail", ...detail.fields.map(f => f.name)]);
  for (const row of rows) {
    add("detail", plugin.encodeRow(row, ctx), detail, false);
  }
  hook("file trailer", plugin.encodeFileTrailer?.(ctx, aggregates), plugin.fileTrailerLayouts);
  return output.map(row => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}
