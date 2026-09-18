export interface LetterRenderQueueOptions {
  maxWaitingPerLane?: number;
  waitTimeoutMs?: number;
}

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class BoundedLane {
  private active = false;
  private readonly waiters: Waiter[] = [];

  constructor(
    private readonly name: string,
    private readonly maxWaiting: number,
    private readonly waitTimeoutMs: number,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (!this.active) {
      this.active = true;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.maxWaiting) {
      return Promise.reject(new Error(
        `Letter renderer ${this.name} queue is full. Please try again shortly.`,
      ));
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index === -1) return;
          this.waiters.splice(index, 1);
          reject(new Error(
            `Timed out waiting for the letter renderer ${this.name} queue.`,
          ));
        }, this.waitTimeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (!next) {
      this.active = false;
      return;
    }
    clearTimeout(next.timer);
    next.resolve();
  }
}

/**
 * Preview and delivery each get one renderer slot so staff preview traffic
 * cannot delay durable outbound mail preparation.
 */
export class LetterRenderQueue {
  private readonly delivery: BoundedLane;
  private readonly preview: BoundedLane;

  constructor(options: LetterRenderQueueOptions = {}) {
    const maxWaiting = options.maxWaitingPerLane ?? 16;
    const waitTimeoutMs = options.waitTimeoutMs ?? 30_000;
    this.delivery = new BoundedLane("delivery", maxWaiting, waitTimeoutMs);
    this.preview = new BoundedLane("preview", maxWaiting, waitTimeoutMs);
  }

  run<T>(previewGuides: boolean, task: () => Promise<T>): Promise<T> {
    return (previewGuides ? this.preview : this.delivery).run(task);
  }
}