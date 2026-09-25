export const TEMPLATE_FONTS: [string, string][] = [["Arial, sans-serif", "Arial"], ["Verdana, sans-serif", "Verdana"], ["Georgia, serif", "Georgia"], ["Times New Roman, serif", "Times New Roman"], ["Courier New, monospace", "Courier New"]];
export const TEMPLATE_SIZES: [string, string][] = [10, 12, 14, 16, 18, 24, 32, 48].map(n => [`${n}px`, `${n}px`]);
export const TEMPLATE_TEXT_COLORS = ["#111827", "#374151", "#6b7280", "#d1d5db", "#dc2626", "#f97316", "#facc15", "#16a34a",
  "#3b82f6", "#1d4ed8", "#9333ea", "#db2777", "#92400e", "#fda4af", "#0891b2", "#f3f4f6"];
export const TEMPLATE_CELL_COLORS = ["#ffffff", "#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", "#e9d5ff", "#fcd34d", "#a7f3d0"];

/** Only direct rows/cells: descendants belonging to nested tables are never edited. */
export function tableRows(table: HTMLTableElement): HTMLTableRowElement[] {
  return Array.from(table.rows).filter(row => row.closest("table") === table);
}

export function simpleTable(table: HTMLTableElement): boolean {
  const rows = tableRows(table);
  return rows.length > 0 && rows.every(row =>
    row.cells.length === rows[0].cells.length &&
    Array.from(row.cells).every(cell => cell.colSpan === 1 && cell.rowSpan === 1));
}

export function makeTable(rows: number, columns: number, layout = false): HTMLTableElement {
  const table = document.createElement("table");
  table.style.cssText = "width:100%;max-width:100%;border-collapse:collapse;table-layout:fixed";
  const body = table.createTBody();
  for (let r = 0; r < rows; r++) {
    const row = body.insertRow();
    for (let c = 0; c < columns; c++) {
      const cell = row.insertCell();
      cell.style.cssText = `padding:12px;vertical-align:top;${layout ? "" : "border:1px solid #999999;"}`;
      cell.appendChild(document.createElement("br"));
    }
  }
  return table;
}

export type TableOperation = "row-before" | "row-after" | "delete-row" | "column-before" | "column-after" | "delete-column" | "merge" | "split" | "delete";

export function editTable(cell: HTMLTableCellElement, operation: TableOperation): void {
  const table = cell.closest("table");
  const row = cell.parentElement as HTMLTableRowElement;
  if (!table || row.tagName !== "TR") throw new Error("Place the caret in a table cell first.");
  if (operation === "delete") { table.remove(); return; }
  if (operation === "split") {
    if (cell.rowSpan !== 1 || cell.colSpan < 2) throw new Error("Only horizontally merged cells can be split. Row-spanning cells are preserved.");
    const count = cell.colSpan;
    cell.colSpan = 1;
    for (let i = 1; i < count; i++) {
      const added = document.createElement(cell.tagName.toLowerCase());
      added.setAttribute("style", cell.getAttribute("style") ?? "");
      added.appendChild(document.createElement("br"));
      cell.after(added);
    }
    return;
  }
  if (!simpleTable(table)) throw new Error("This table has merged or irregular cells. Split horizontal merges before changing rows or columns.");
  if (operation === "merge") {
    const next = cell.nextElementSibling as HTMLTableCellElement | null;
    if (!next || next.tagName !== cell.tagName) throw new Error("Select a cell with a compatible cell immediately to its right.");
    cell.appendChild(document.createElement("br"));
    while (next.firstChild) cell.appendChild(next.firstChild);
    cell.colSpan = 2;
    next.remove();
    return;
  }
  const rows = tableRows(table);
  if (operation === "delete-row") {
    if (rows.length === 1) table.remove(); else row.remove();
  } else if (operation === "delete-column") {
    if (row.cells.length === 1) table.remove();
    else { const index = cell.cellIndex; rows.forEach(item => item.deleteCell(index)); }
  } else if (operation.startsWith("row-")) {
    const added = document.createElement("tr");
    Array.from(row.cells).forEach(existing => {
      const blank = existing.cloneNode(false) as HTMLTableCellElement;
      blank.removeAttribute("id");
      blank.appendChild(document.createElement("br"));
      added.appendChild(blank);
    });
    if (operation === "row-before") row.before(added); else row.after(added);
  } else {
    const index = cell.cellIndex + (operation === "column-after" ? 1 : 0);
    rows.forEach(item => {
      const blank = document.createElement("td");
      blank.style.cssText = cell.style.cssText;
      blank.appendChild(document.createElement("br"));
      item.insertBefore(blank, item.cells[index] ?? null);
    });
  }
}

export function insertAtSelection(editor: HTMLElement, element: HTMLElement): void {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !editor.contains(range.commonAncestorContainer)) {
    editor.appendChild(element);
    return;
  }
  range.deleteContents();
  range.insertNode(element);
  range.setStartAfter(element);
  range.collapse(true);
  selection!.removeAllRanges();
  selection!.addRange(range);
}