import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

const network = vi.hoisted(() => ({
  resolve4: vi.fn(),
  request: vi.fn(),
  replies: [] as Array<{
    status?: number;
    headers?: Record<string, string>;
    body?: Buffer;
    hang?: boolean;
  }>,
  pinned: [] as string[],
  requests: [] as Array<EventEmitter & {
    end: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
  responses: [] as Array<EventEmitter & {
    statusCode: number;
    headers: Record<string, string>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("node:dns/promises", () => ({ resolve4: network.resolve4 }));
vi.mock("node:https", () => ({
  request: network.request,
}));

import { downloadRemoteLetterPdf } from "../../server/services/comm/remote-letter-pdf";
import { prepareLetterImages, rasterImageType } from "../../server/services/comm/letter-images";

async function letterPdf(width = 612, height = 792): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.addPage([width, height]);
  return Buffer.from(await pdf.save());
}

describe("downloadRemoteLetterPdf", () => {
  beforeEach(() => {
    network.replies.length = 0;
    network.pinned.length = 0;
    network.requests.length = 0;
    network.responses.length = 0;
    network.resolve4.mockReset();
    network.request.mockReset();
    network.resolve4.mockResolvedValue(["8.8.8.8"]);
    network.request.mockImplementation((
      url: URL,
      options: {
        agent: boolean;
        lookup: (
          hostname: string,
          options: { all?: boolean },
          callback: (error: null, address: string, family: number) => void,
        ) => void;
      },
      onResponse: (response: EventEmitter & {
        statusCode: number;
        headers: Record<string, string>;
        destroy: ReturnType<typeof vi.fn>;
      }) => void,
    ) => {
      const req = new EventEmitter() as EventEmitter & {
        end: ReturnType<typeof vi.fn>;
        destroy: ReturnType<typeof vi.fn>;
      };
      req.destroy = vi.fn();
      req.end = vi.fn(() => {
        options.lookup(url.hostname, {}, (_error, address, family) => {
          network.pinned.push(`${address}/${family}`);
          const reply = network.replies.shift();
          if (!reply) throw new Error("Test did not provide a mocked response");
          const res = new EventEmitter() as EventEmitter & {
            statusCode: number;
            headers: Record<string, string>;
            destroy: ReturnType<typeof vi.fn>;
          };
          res.statusCode = reply.status ?? 200;
          res.headers = reply.headers ?? { "content-type": "application/pdf" };
          res.destroy = vi.fn();
          network.responses.push(res);
          onResponse(res);
          if (!reply.hang) {
            queueMicrotask(() => {
              if (reply.body) res.emit("data", reply.body);
              res.emit("end");
            });
          }
        });
      });
      network.requests.push(req);
      expect(options.agent).toBe(false);
      return req;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    "http://letters.example/file.pdf",
    "https://user:secret@letters.example/file.pdf",
    "https://letters.example:444/file.pdf",
    "https://[::1]/file.pdf",
    "https://127.0.0.1/file.pdf",
    "https://10.2.3.4/file.pdf",
    "https://100.64.0.1/file.pdf",
    "https://169.254.1.1/file.pdf",
    "https://172.20.1.1/file.pdf",
    "https://192.0.2.10/file.pdf",
    "https://198.51.100.10/file.pdf",
    "https://203.0.113.10/file.pdf",
    "https://224.0.0.1/file.pdf",
  ])("refuses an unsafe URL without issuing a request: %s", async (url) => {
    await expect(downloadRemoteLetterPdf(url)).rejects.toThrow("refused");
    expect(network.request).not.toHaveBeenCalled();
  });

  it("refuses a hostname if any returned IPv4 address is non-public", async () => {
    network.resolve4.mockResolvedValue(["8.8.8.8", "192.168.1.2"]);

    await expect(downloadRemoteLetterPdf("https://letters.example/file.pdf"))
      .rejects.toThrow("private or reserved");
    expect(network.request).not.toHaveBeenCalled();
  });

  it("pins DNS for each validated redirect hop and accepts a Letter PDF", async () => {
    const pdf = await letterPdf();
    network.resolve4
      .mockResolvedValueOnce(["8.8.8.8"])
      .mockResolvedValueOnce(["1.1.1.1"]);
    network.replies.push(
      {
        status: 302,
        headers: { location: "https://cdn.example/final.pdf" },
      },
      {
        headers: { "content-type": "application/pdf; charset=binary" },
        body: pdf,
      },
    );

    await expect(downloadRemoteLetterPdf("https://letters.example/start"))
      .resolves.toEqual(pdf);
    expect(network.pinned).toEqual(["8.8.8.8/4", "1.1.1.1/4"]);
    expect(network.resolve4).toHaveBeenCalledTimes(2);
  });

  it("never treats HTML or non-PDF bytes as a letter", async () => {
    network.replies.push({
      headers: { "content-type": "text/html" },
      body: Buffer.from("<html>not a letter</html>"),
    });
    await expect(downloadRemoteLetterPdf("https://letters.example/file"))
      .rejects.toThrow("not application/pdf");

    network.replies.push({
      headers: { "content-type": "application/pdf" },
      body: Buffer.from("<html>still not a letter</html>"),
    });
    await expect(downloadRemoteLetterPdf("https://letters.example/file"))
      .rejects.toThrow("valid PDF signature");
  });

  it("refuses valid PDFs whose pages are not US Letter", async () => {
    network.replies.push({ body: await letterPdf(595, 842) });
    await expect(downloadRemoteLetterPdf("https://letters.example/a4.pdf"))
      .rejects.toThrow("US Letter");
  });

  it("the overall deadline destroys both an in-flight response and request", async () => {
    vi.useFakeTimers();
    network.replies.push({ hang: true });

    const result = downloadRemoteLetterPdf("https://letters.example/slow.pdf");
    await Promise.resolve();
    await Promise.resolve();
    expect(network.responses).toHaveLength(1);

    const rejection = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
    expect(network.responses[0].destroy).toHaveBeenCalled();
    expect(network.requests[0].destroy).toHaveBeenCalled();
  });

  it("pins raster image downloads and embeds only verified PNG bytes", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=", "base64");
    network.replies.push({ headers: { "content-type": "image/png" }, body: png });
    const result = await prepareLetterImages(["https://images.example/logo.png"]);
    expect(result).toEqual([`data:image/png;base64,${png.toString("base64")}`]);
    expect(network.pinned).toEqual(["8.8.8.8/4"]);
  });

  it("refuses images redirected into a private network", async () => {
    network.replies.push({ status: 302, headers: { location: "https://127.0.0.1/logo.png" } });
    await expect(prepareLetterImages(["https://images.example/logo.png"])).rejects.toThrow("private or reserved");
    expect(network.request).toHaveBeenCalledTimes(1);
  });

  it("refuses unsupported images, excessive counts and oversized pixel buffers", async () => {
    await expect(prepareLetterImages(Array(11).fill("https://images.example/a.png"))).rejects.toThrow("at most 10");
    network.replies.push({ headers: { "content-type": "image/svg+xml" }, body: Buffer.from("<svg/>") });
    await expect(prepareLetterImages(["https://images.example/a.svg"])).rejects.toThrow("not image/png or image/jpeg");
    expect(() => rasterImageType(Buffer.from("<svg/>"))).toThrow("only PNG and JPEG");
    const bomb = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bomb);
    bomb.write("IHDR", 12);
    bomb.writeUInt32BE(10000, 16);
    bomb.writeUInt32BE(10000, 20);
    expect(() => rasterImageType(bomb)).toThrow("dimensions");
  });

  it("rejects oversized raster responses before reading the body", async () => {
    network.replies.push({ headers: { "content-type": "image/png", "content-length": "1048577" } });
    await expect(prepareLetterImages(["https://images.example/a.png"])).rejects.toThrow("byte limit");
  });
});