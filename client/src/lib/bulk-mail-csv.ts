import type { QueryClient } from "@tanstack/react-query";

export type MailCsvMode = "outstanding" | "all";

export type MailCsvResult =
  | {
      kind: "file";
      blob: Blob;
      filename?: string;
      recipientCount: number;
      blockedCount: number;
      missingAddressCount: number;
    }
  | {
      kind: "no-file";
      message: string;
      blockedCount: number;
      missingAddressCount: number;
    };

function count(value: string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function requestMailCsv(
  url: string,
  mode: MailCsvMode,
  request: typeof fetch = fetch,
): Promise<MailCsvResult> {
  const response = await request(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  const contentType = response.headers.get("Content-Type") || "";

  if (!response.ok) {
    let message = response.statusText || "The mail CSV could not be prepared.";
    try {
      const body = await response.json();
      message = body.message || body.error || message;
    } catch {
      // Keep the response status when the server did not return JSON.
    }
    throw new Error(message);
  }

  if (contentType.toLowerCase().includes("application/json")) {
    const result = await response.json();
    if (result?.noFile === true) {
      return {
        kind: "no-file",
        message: typeof result.message === "string" ? result.message : "There are no recipients to export.",
        blockedCount: count(result.blockedCount),
        missingAddressCount: count(result.missingAddressCount),
      };
    }
  }

  if (!contentType.toLowerCase().includes("text/csv")) {
    throw new Error("The server did not return a CSV file.");
  }

  const disposition = response.headers.get("Content-Disposition");
  const filename = disposition?.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)?.[1]
    ?.replace(/^"|"$/g, "");
  return {
    kind: "file",
    blob: await response.blob(),
    filename,
    recipientCount: count(response.headers.get("X-Recipient-Count")),
    blockedCount: count(response.headers.get("X-Blocked-Recipient-Count")),
    missingAddressCount: count(response.headers.get("X-Missing-Address-Count")),
  };
}

export function invalidateMailCsvQueries(queryClient: QueryClient, messageId: string) {
  queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages", messageId] });
  queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages"] });
  queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages", messageId, "participants"] });
  queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages", messageId, "delivery-stats"] });
  queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages", messageId, "token-coverage"] });
}
