import { expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({}) }));
vi.mock("../../server/storage/system/logs", () => ({ createLogsStorage: () => ({ create: f.create }) }));
import { LogsTransport } from "../../server/services/logs-transport";

it("carries per-entry privacy to storage without storing it as request metadata", async () => {
  const transport = new LogsTransport();
  await transport.log({ level: "info", message: "Private", publishEvent: false, payload: "private-canary" }, () => {});
  expect(f.create).toHaveBeenCalledWith(
    expect.objectContaining({ meta: { payload: "private-canary" } }),
    { publishEvent: false },
  );
});
