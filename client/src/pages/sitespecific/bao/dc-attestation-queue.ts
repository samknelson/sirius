export type LatestSaveQueue<T> = {
  enqueue(value: T): void;
  dispose(): void;
};

type QueueOptions<T, R> = {
  delayMs: number;
  save(value: T): Promise<R>;
  onStart?: () => void;
  onSuccess?: (
    result: R,
    value: T,
    isLatest: boolean,
    isActive: () => boolean,
  ) => void | Promise<void>;
  onError?: (
    error: unknown,
    value: T,
    hasNewerValue: boolean,
    isActive: () => boolean,
  ) => void | Promise<void>;
  onSettled?: (isActive: () => boolean) => void;
};

/**
 * Debounced, single-flight latest-value persistence.
 *
 * A value arriving while a request is in flight is retained and sent after
 * that request settles. A failed request only discards its own snapshot; a
 * newer value remains queued for retry.
 */
export function createLatestSaveQueue<T, R>({
  delayMs,
  save,
  onStart,
  onSuccess,
  onError,
  onSettled,
}: QueueOptions<T, R>): LatestSaveQueue<T> {
  let latest: T | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let disposed = false;
  let revision = 0;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    if (disposed || latest === undefined) return;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delayMs);
  };

  const flush = async () => {
    if (disposed || inFlight || latest === undefined) return;
    const snapshot = latest;
    latest = undefined;
    const snapshotRevision = revision;
    inFlight = true;
    onStart?.();
    const isActive = () => !disposed;
    try {
      const result = await save(snapshot);
      if (!disposed) {
        await onSuccess?.(result, snapshot, revision === snapshotRevision, isActive);
      }
    } catch (error) {
      const hasNewerValue = latest !== undefined && revision !== snapshotRevision;
      if (!disposed) {
        await onError?.(error, snapshot, hasNewerValue, isActive);
      }
    } finally {
      inFlight = false;
      if (disposed) return;
      onSettled?.(isActive);
      if (latest !== undefined) schedule();
    }
  };

  return {
    enqueue(value: T) {
      if (disposed) return;
      latest = value;
      revision += 1;
      schedule();
    },
    dispose() {
      disposed = true;
      latest = undefined;
      clearTimer();
    },
  };
}