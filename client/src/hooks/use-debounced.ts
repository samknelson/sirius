import { useEffect, useState } from "react";

/**
 * Trail a fast-changing value: the returned value only catches up once the
 * input has held still for `ms`. Use it to key server requests off rapid
 * user input (typing, checkbox clicking) so a burst of changes costs one
 * round trip instead of one per change.
 */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
