import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recordGoHref } from "@shared/utils/record-go";

const metadataListSource = readFileSync("client/src/pages/admin/metadata-list.tsx", "utf8");
const logsSource = readFileSync("client/src/pages/config/logs.tsx", "utf8");

describe("admin record navigation links", () => {
  it("encodes identifiers with the server-owned Go to record path", () => {
    expect(recordGoHref("  record/with spaces  ")).toBe("/go/record%2Fwith%20spaces");
  });

  it("keeps metadata rows on ordinary full-navigation anchors", () => {
    expect(metadataListSource).not.toContain('from "wouter"');
    expect(metadataListSource).toContain("<a");
    expect(metadataListSource).toContain('href={row.href}');
    expect(metadataListSource).toContain('data-testid={`link-record-${row.seq}`}');
    expect(metadataListSource).not.toContain("row.href &&");
  });

  it("links present log entity IDs and preserves N/A for absent IDs", () => {
    expect(logsSource).toContain('data-testid="link-log-entity-id"');
    expect(logsSource).toContain("selectedLog.entityId?.trim()");
    expect(logsSource).toContain('>N/A</p>');
    expect(logsSource).toContain("recordGoHref(selectedLog.entityId)");
    expect(logsSource).toContain('data-testid={`link-log-record-${log.id}`}');
    expect(logsSource).toContain("log.entityId?.trim()");
    expect(logsSource).toContain("recordGoHref(log.entityId)");
    expect(logsSource).toContain("View record");
  });
});