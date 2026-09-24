// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { editTable, makeTable, simpleTable, tableRows } from "../../client/src/components/ui/template-table-tools";
import { normalizeTemplateHtml } from "../../shared/utils/html";

describe("visual template table operations", () => {
  it("inserts, adds and removes rows and columns without cloning nested content", () => {
    const table = makeTable(2, 2);
    const cell = table.rows[0].cells[0];
    const nested = makeTable(2, 2);
    cell.appendChild(nested);
    editTable(cell, "row-after");
    expect(tableRows(table)).toHaveLength(3);
    expect(table.rows[1].querySelector("table")).toBeNull();
    editTable(cell, "column-after");
    expect(table.rows[0].cells).toHaveLength(3);
    expect(nested.rows[0].cells).toHaveLength(2);
    editTable(cell, "delete-column");
    expect(table.rows[0].cells).toHaveLength(2);
  });
  it("merges horizontal cells, guards span edits and splits back", () => {
    const table = makeTable(2, 2);
    const cell = table.rows[0].cells[0];
    cell.textContent = "One";
    table.rows[0].cells[1].textContent = "{{worker.name}}";
    editTable(cell, "merge");
    expect(cell.colSpan).toBe(2);
    expect(cell.textContent).toBe("One{{worker.name}}");
    expect(simpleTable(table)).toBe(false);
    expect(() => editTable(cell, "row-after")).toThrow("merged or irregular");
    editTable(cell, "split");
    expect(simpleTable(table)).toBe(true);
    cell.rowSpan = 2;
    expect(() => editTable(cell, "split")).toThrow("Row-spanning");
  });
  it("preserves generated layout styles under the delivery normalizer", () => {
    const table = makeTable(1, 2, true);
    table.rows[0].cells[0].textContent = '{{worker.field(name="firstName")}}';
    const html = normalizeTemplateHtml(table.outerHTML);
    expect(html).toContain('table-layout:fixed');
    expect(html).toContain('vertical-align:top');
    expect(html).toContain('{{worker.field(name="firstName")}}');
    expect(normalizeTemplateHtml(html)).toBe(html);
  });
});