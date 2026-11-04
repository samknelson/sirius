/**
 * Runs before React/auth/providers/injected scripts. A hard document boundary
 * intentionally replaces normal QueryClient/component/blob/draft state.
 */
export async function installPresentationGuard(): Promise<boolean> {
  const nativeFetch = window.fetch.bind(window);
  // General component bootstrap, not the Mask Mode state endpoint. With the
  // component disabled no interception, listeners or polling are installed.
  try {
    const response = await nativeFetch("/api/components/presentation", {
      credentials: "same-origin", cache: "no-store",
    });
    if (!response.ok) throw new Error("Component availability unavailable");
    const availability = await response.json();
    if (availability.maskModeEnabled === false) return true;
    if (availability.maskModeEnabled !== true) throw new Error("Invalid component availability");
  } catch {
    window.location.replace("/mask-mode");
    return false;
  }
  let blocked = false;
  let revision = "";
  const cover = () => {
    if (blocked) return;
    blocked = true;
    document.title = "Checking protection";
    // The initiating document is discarded; don't save forms or attempt to
    // scrub arbitrarily shaped localStorage/clipboard/history into "safety".
    document.documentElement.style.visibility = "hidden";
    window.location.replace("/mask-mode");
  };
  const check = async () => {
    try {
      const response = await nativeFetch("/api/mask-mode/state", {
        credentials: "same-origin", cache: "no-store",
      });
      if (response.status === 404 && (await response.json()).code === "component_disabled") {
        blocked = true;
        document.documentElement.style.visibility = "hidden";
        window.location.replace("/");
        return false;
      }
      if (!response.ok) throw new Error("Presentation state unavailable");
      const state = await response.json();
      if (!["off", "anonymous"].includes(state.mode)) { cover(); return false; }
      const nextRevision = String(state.revision);
      if (revision && revision !== nextRevision) { cover(); return false; }
      revision = nextRevision;
      return true;
    } catch {
      cover();
      return false;
    }
  };
  if (!await check()) return false;

  const channel = typeof BroadcastChannel === "function"
    ? new BroadcastChannel("sirius-mask-mode") : null;
  channel?.addEventListener("message", cover);
  window.addEventListener("pageshow", event => {
    if (event.persisted) { cover(); }
  });
  // Hide BEFORE revalidating on focus, so a stale UI is not shown as ready.
  const revalidate = async () => {
    if (blocked) return;
    document.documentElement.style.visibility = "hidden";
    if (await check() && !blocked) document.documentElement.style.visibility = "";
  };
  window.addEventListener("focus", () => void revalidate());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void revalidate();
  });
  setInterval(() => void check(), 5000);

  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    const localApi = url.origin === location.origin && url.pathname.startsWith("/api/");
    if (!localApi) return nativeFetch(input, init);
    if (blocked) throw new Error("Presentation changed");
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("X-Mask-Revision", revision);
    const response = await nativeFetch(input, { ...init, headers });
    const assertCurrent = () => {
      if (blocked || response.headers.get("X-Mask-Mode") === "on" ||
          response.headers.get("X-Mask-Mode") === "unknown" ||
          (response.headers.has("X-Mask-Revision") && response.headers.get("X-Mask-Revision") !== revision)) {
        cover();
        throw new Error("Presentation changed; response discarded");
      }
    };
    assertCurrent();
    // Check again AFTER body resolution. Cancellation alone cannot stop an
    // already resolving promise from publishing data to a QueryClient.
    const protect = (target: Response): Response => new Proxy(target, {
      get(object, property) {
        if (property === "clone") return () => protect(object.clone());
        const value = Reflect.get(object, property, object);
        if (["json", "text", "blob", "arrayBuffer", "formData"].includes(String(property))) {
          return async (...args: unknown[]) => {
            const result = await value.apply(object, args);
            assertCurrent();
            return result;
          };
        }
        return typeof value === "function" ? value.bind(object) : value;
      },
    });
    return protect(response);
  };
  return true;
}
