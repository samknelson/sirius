function isOldMappingFormat(mapping: Record<string, string>): boolean {
  const keys = Object.keys(mapping);
  return keys.length > 0 && keys.every((key) => key.startsWith("col_"));
}

function columnIndex(columnKey: string): number | null {
  const match = /^col_(\d+)$/.exec(columnKey);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) ? index : null;
}

function normalizedHeader(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase();
}

/**
 * Carries an inherited mapping onto an initial upload. Header-based files are
 * matched by header name so reordered columns remain safe; headerless files
 * retain only column indexes present in the new file.
 */
export function reconcileInheritedColumnMapping(
  mapping: Record<string, string>,
  sourceHeaders: unknown[] | undefined,
  uploadedRows: unknown[][],
  hasHeaders: boolean,
): Record<string, string> {
  const columnCount = uploadedRows[0]?.length ?? 0;
  if (columnCount === 0) return {};

  const newHeaders = hasHeaders ? uploadedRows[0] : undefined;
  const headerIndexes = new Map<string, number[]>();
  const sourceHeaderCounts = new Map<string, number>();
  if (sourceHeaders) {
    for (const value of sourceHeaders) {
      const header = normalizedHeader(value);
      if (!header) continue;
      sourceHeaderCounts.set(header, (sourceHeaderCounts.get(header) ?? 0) + 1);
    }
  }
  if (sourceHeaders && newHeaders) {
    for (let index = 0; index < newHeaders.length; index++) {
      const header = normalizedHeader(newHeaders[index]);
      if (!header) continue;
      const indexes = headerIndexes.get(header) ?? [];
      indexes.push(index);
      headerIndexes.set(header, indexes);
    }
  }

  const resolveColumn = (key: string): string | null => {
    if (key === "_unmapped") return key;
    const oldIndex = columnIndex(key);
    if (oldIndex === null) return null;

    if (sourceHeaders && newHeaders) {
      const sourceHeader = normalizedHeader(sourceHeaders[oldIndex]);
      const matches = headerIndexes.get(sourceHeader);
      return sourceHeader &&
        sourceHeaderCounts.get(sourceHeader) === 1 &&
        matches?.length === 1
        ? `col_${matches[0]}`
        : null;
    }

    return oldIndex < columnCount ? `col_${oldIndex}` : null;
  };

  const reconciled: Record<string, string> = {};
  const usedColumns = new Set<string>();
  if (isOldMappingFormat(mapping)) {
    for (const [oldColumn, fieldId] of Object.entries(mapping)) {
      const newColumn = resolveColumn(oldColumn);
      if (!newColumn || newColumn === "_unmapped" || usedColumns.has(newColumn))
        continue;
      reconciled[newColumn] = fieldId;
      usedColumns.add(newColumn);
    }
  } else {
    for (const [fieldId, oldColumn] of Object.entries(mapping)) {
      const newColumn = resolveColumn(oldColumn);
      if (!newColumn) continue;
      if (newColumn !== "_unmapped" && usedColumns.has(newColumn)) continue;
      reconciled[fieldId] = newColumn;
      if (newColumn !== "_unmapped") usedColumns.add(newColumn);
    }
  }

  return reconciled;
}