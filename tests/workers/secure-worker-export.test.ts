import { describe, expect, it, vi } from "vitest";
import { fetchSecureWorkerExport } from "../../client/src/lib/secure-worker-export";

function responseWithStream(
  stream: ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
): Response {
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/csv; charset=utf-8", ...headers },
  });
}

describe("secure worker export download", () => {
  it("uses POST credentials and returns a complete CSV blob", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.credentials).toBe("include");
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      expect(JSON.parse(String(init?.body))).toEqual({ employerId: "12", ssn: "" });
      return new Response("name\nAda\n", {
        status: 200,
        headers: { "content-type": "text/csv", "content-length": "9" },
      });
    });

    const blob = await fetchSecureWorkerExport(
      { employerId: "12" },
      "",
      fetchMock as unknown as typeof fetch,
    );

    expect(blob.type).toBe("text/csv");
    expect(await blob.text()).toBe("name\nAda\n");
  });

  it("rejects a response with a non-CSV content type", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      fetchSecureWorkerExport({}, "", fetchMock as unknown as typeof fetch),
    ).rejects.toThrow("unexpected content type");
  });

  it("rejects a truncated stream and never returns a partial blob", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("name\n"));
        controller.error(new Error("connection reset"));
      },
    });
    const fetchMock = vi.fn(async () =>
      responseWithStream(stream, { "content-length": "20" }),
    );

    await expect(
      fetchSecureWorkerExport({}, "", fetchMock as unknown as typeof fetch),
    ).rejects.toThrow("connection reset");
  });

  it("surfaces a network failure to the caller", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(
      fetchSecureWorkerExport({}, "", fetchMock as unknown as typeof fetch),
    ).rejects.toThrow("Failed to fetch");
  });
});