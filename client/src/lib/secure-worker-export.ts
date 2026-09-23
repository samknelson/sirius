/**
 * Fetch a worker export without treating an interrupted response as a
 * successful download. The export endpoint streams its CSV, so response.blob()
 * alone is not sufficient: some fetch implementations can resolve it after a
 * stream has delivered only part of the body.
 */
export async function fetchSecureWorkerExport(
  filters: Record<string, string>,
  ssn: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Blob> {
  const response = await fetchImplementation("/api/workers/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ...filters, ssn }),
  });

  if (!response.ok) {
    throw new Error(`Worker export failed (${response.status})`);
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "text/csv") {
    throw new Error("Worker export returned an unexpected content type");
  }

  const declaredLength = response.headers.get("content-length");
  const expectedLength = declaredLength === null ? undefined : Number(declaredLength);
  if (
    expectedLength !== undefined &&
    (!Number.isSafeInteger(expectedLength) || expectedLength < 0)
  ) {
    throw new Error("Worker export returned an invalid content length");
  }

  if (!response.body) {
    throw new Error("Worker export response did not include a body");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) throw new Error("Worker export returned an empty stream chunk");
      chunks.push(value);
      receivedLength += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  if (expectedLength !== undefined && receivedLength !== expectedLength) {
    throw new Error("Worker export response was incomplete");
  }

  return new Blob(chunks, { type: "text/csv" });
}