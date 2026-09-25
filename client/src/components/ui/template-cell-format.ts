export type CellFormat = "font-family" | "font-size" | "color" | "background-color";

const markers: Record<string, string> = {
  "font-family": "template-cell-family",
  "font-size": "template-cell-size",
  color: "template-cell-text-color",
};

/** Override inherited and existing inline text styles without flattening links or other markup. */
export function formatTemplateCell(cell: HTMLTableCellElement, property: CellFormat, value: string | null): void {
  if (property === "background-color") {
    if (value) cell.style.setProperty(property, value);
    else cell.style.removeProperty(property);
    return;
  }
  const marker = markers[property];
  for (const span of Array.from(cell.querySelectorAll<HTMLSpanElement>(`span.${marker}`))) {
    if (span.closest("td,th") !== cell) continue;
    // Unwrap first, so reapplying cannot create nested wrappers.
    span.replaceWith(...Array.from(span.childNodes));
  }
  if (value) {
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) {
      const text = walker.currentNode as Text;
      if (text.textContent?.length && text.parentElement?.closest("td,th") === cell) nodes.push(text);
    }
    for (const text of nodes) {
      const span = document.createElement("span");
      span.className = marker;
      span.style.setProperty(property, value);
      text.replaceWith(span);
      span.appendChild(text);
    }
    cell.style.setProperty(property, value);
  } else {
    cell.style.removeProperty(property);
  }
}

export function cellFormatValue(cell: HTMLTableCellElement, property: CellFormat): string {
  if (cell.style.getPropertyValue(property)) return cell.style.getPropertyValue(property);
  const text = Array.from(cell.querySelectorAll("*")).find(el =>
    el.closest("td,th") === cell && el.textContent?.trim() && !el.querySelector("td,th"));
  return getComputedStyle(text ?? cell).getPropertyValue(property).trim();
}