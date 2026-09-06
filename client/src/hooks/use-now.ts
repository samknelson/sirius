import { useEffect, useState } from "react";

/**
 * The current instant, re-read on a timer.
 *
 * For surfaces that show a running clock. The value is a real instant — the
 * zone it gets rendered in is the formatter's business, not this hook's, which
 * is what lets one tick drive several clocks in different zones.
 *
 * The interval is a re-render budget, not a promise of accuracy: a component
 * showing minutes still wants a short interval, because a long one puts the
 * rollover up to that long after the actual minute boundary.
 */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // Re-read immediately as well as on the interval: a tab that was
    // backgrounded may have had its timers throttled, so the state can be
    // stale by much more than one interval by the time this runs again.
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
