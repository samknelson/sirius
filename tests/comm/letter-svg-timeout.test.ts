import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";

const workers = vi.hoisted(() => ({
  created: [] as Array<EventEmitter & { terminate: () => Promise<number> }>,
  spin: false,
  real: undefined as import("node:worker_threads").Worker | undefined,
}));
vi.mock("node:worker_threads", async (original) => {
  const { Worker } = await original<typeof import("node:worker_threads")>();
  return {
    Worker: class extends EventEmitter {
      terminate: () => Promise<number> = vi.fn(async () => 1);
      constructor() {
        super();
        if (workers.spin) {
          workers.real = new Worker('require("node:worker_threads").parentPort.postMessage({ready:true}); while(true) {}', { eval: true });
          // The ready signal proves busy execution but is not converter output.
          const on = workers.real.once.bind(workers.real);
          workers.real.once = ((event: string, callback: (...args: unknown[]) => void) => {
            if (event === "message") return workers.real!;
            return on(event, callback);
          }) as typeof workers.real.once;
          return workers.real;
        }
        workers.created.push(this);
      }
    },
  };
});
import { convertLetterSvg, SVG_CONVERSION_TIMEOUT_MS } from "../../server/services/comm/letter-svg";

afterEach(async () => {
  vi.useRealTimers(); workers.created.length = 0; workers.spin = false;
  await workers.real?.terminate(); workers.real = undefined;
});

it("terminates and awaits an unresponsive worker at the real overall deadline", async () => {
  vi.useFakeTimers();
  const result = convertLetterSvg(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'));
  const rejection = expect(result).rejects.toMatchObject({ category: "timeout" });
  await vi.advanceTimersByTimeAsync(SVG_CONVERSION_TIMEOUT_MS);
  await rejection;
  expect(workers.created[0].terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("terminates on worker failure without leaking its raw error or a timer", async () => {
  vi.useFakeTimers();
  const result = convertLetterSvg(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'));
  workers.created[0].emit("error", new Error("file:///private?token=canary"));
  await expect(result).rejects.toMatchObject({ message: "SVG converter failed." });
  expect(workers.created[0].terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("interrupts actual synchronous execution and waits for real thread exit", async () => {
  vi.useFakeTimers();
  workers.spin = true;
  const result = convertLetterSvg(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'));
  await new Promise<void>((resolve) => workers.real!.on("message", () => resolve()));
  const rejection = expect(result).rejects.toMatchObject({ category: "timeout" });
  await vi.advanceTimersByTimeAsync(SVG_CONVERSION_TIMEOUT_MS);
  await rejection;
  expect(workers.real!.threadId).toBe(-1);
  expect(vi.getTimerCount()).toBe(0);
});
