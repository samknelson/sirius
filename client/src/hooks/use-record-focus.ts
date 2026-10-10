import { useEffect, useRef } from "react";
import { useSearch } from "wouter";

export function recordFocusElementId(id: string): string {
  return `record-source-${encodeURIComponent(id)}`;
}

/** Go child destinations focus only an item in the already authorized, scoped list. */
export function useRecordFocus(
  ids: readonly string[], scope: string, pending: boolean, failed: boolean,
) {
  const search = useSearch();
  const id = new URLSearchParams(search).get("record");
  const found = !!id && ids.includes(id);
  const lastFocused = useRef<string>();
  useEffect(() => {
    if (!id || !found || pending || failed) return;
    const key = `${scope}:${id}`;
    if (lastFocused.current === key) return;
    const element = document.getElementById(recordFocusElementId(id));
    if (!element) return;
    element.scrollIntoView({ block: "center" });
    element.focus({ preventScroll: true });
    lastFocused.current = key;
  }, [id, found, scope, pending, failed, ids]);
  return {
    id,
    missing: !!id && !pending && !failed && !found,
    matches: (recordId: string) => id === recordId,
  };
}
