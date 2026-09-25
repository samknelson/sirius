import { useState } from "react";
import { formatTemplateCell, cellFormatValue, type CellFormat } from "./template-cell-format";
import { editTable, TEMPLATE_FONTS, TEMPLATE_SIZES, TEMPLATE_TEXT_COLORS, TEMPLATE_CELL_COLORS, type TableOperation } from "./template-table-tools";

interface Props {
  cell: HTMLTableCellElement;
  disabled: boolean;
  execute: (mutation: () => void) => void;
  close: () => void;
}

const operations: [TableOperation, string][] = [
  ["row-before", "Row above"], ["row-after", "Row below"], ["delete-row", "Delete row"],
  ["column-before", "Column left"], ["column-after", "Column right"], ["delete-column", "Delete column"],
  ["merge", "Merge right"], ["split", "Split cell"], ["delete", "Delete table"],
];

export function TemplateCellMenu({ cell, disabled, execute, close }: Props) {
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const apply = (property: CellFormat, value: string | null) => {
    if (disabled || !cell.isConnected) return;
    execute(() => formatTemplateCell(cell, property, value));
    setRevision(n => n + 1);
  };
  const current = (property: CellFormat) => {
    void revision;
    return cellFormatValue(cell, property);
  };
  const choice = (label: string, property: CellFormat, options: [string, string][]) =>
    <label className="flex items-center justify-between gap-2 text-xs">{label}
      <select aria-label={label} disabled={disabled} className="min-w-28 max-w-44 rounded border bg-background p-1"
        value={options.find(([value]) => value.toLowerCase() === current(property).replaceAll('"', "").toLowerCase())?.[0] ?? (cell.style.getPropertyValue(property) ? "__current" : "")}
        onChange={event => apply(property, event.target.value || null)}>
        <option value="">Default / reset</option>
        {cell.style.getPropertyValue(property) && !options.some(([value]) => value.toLowerCase() === current(property).replaceAll('"', "").toLowerCase()) &&
          <option value="__current" disabled>Current: {current(property)}</option>}
        {options.map(([value, name]) => <option value={value} key={value}>{name}</option>)}
      </select>
    </label>;
  const color = (label: string, property: CellFormat, presets: string[]) => {
    const value = current(property);
    const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/i.exec(value);
    const selected = rgb ? `#${rgb.slice(1).map(n => Number(n).toString(16).padStart(2, "0")).join("")}` : value;
    return <div role="group" aria-label={label} className="space-y-1">
      <span className="text-xs">{label}: {value || "Default"}</span>
      <div className="flex flex-wrap gap-1">
        {presets.map(hex => <button type="button" key={hex} disabled={disabled}
          aria-label={`${label} ${hex}`} title={hex} aria-pressed={selected.toLowerCase() === hex}
          className="h-6 w-6 rounded border focus-visible:ring-2 focus-visible:ring-ring"
          style={{ backgroundColor: hex }} onClick={() => apply(property, hex)} />)}
      </div>
      <label className="flex items-center gap-2 text-xs">Custom {label.toLowerCase()}
        <input type="color" aria-label={`Custom ${label}`} disabled={disabled}
          value={/^#[0-9a-f]{6}$/i.test(selected) ? selected : "#ffffff"}
          onChange={event => apply(property, event.target.value)} />
      </label>
      <button type="button" disabled={disabled} className="text-xs underline" onClick={() => apply(property, null)}>Reset {label.toLowerCase()}</button>
    </div>;
  };
  return <div className="space-y-2 border-t p-2" role="group" aria-label="Cell formatting">
    <p className="text-xs font-semibold">Format this cell</p>
    {choice("Cell font family", "font-family", TEMPLATE_FONTS)}
    {choice("Cell font size", "font-size", TEMPLATE_SIZES)}
    {color("Cell text color", "color", TEMPLATE_TEXT_COLORS)}
    {color("Cell background color", "background-color", TEMPLATE_CELL_COLORS)}
    <details><summary className="cursor-pointer text-xs">Table actions</summary>
      <div className="grid grid-cols-2 gap-1 p-1">{operations.map(([operation, label]) =>
        <button key={operation} type="button" disabled={disabled} className="rounded border p-1 text-left text-xs"
          onClick={() => {
            try { execute(() => editTable(cell, operation)); close(); }
            catch (e) { setError(e instanceof Error ? e.message : "Table action failed."); }
          }}>{label}</button>)}</div>
    </details>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}