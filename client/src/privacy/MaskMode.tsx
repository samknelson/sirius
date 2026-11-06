import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { maskPersonal, type PersonalField } from "@shared/privacy/mask-mode";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface State {
  enabled: boolean;
  mode: "on" | "off";
  revision: number;
  canToggle: boolean;
}
interface DisplayState extends State {
  error: string;
  busy: boolean;
  refresh(): Promise<void>;
  toggle(): Promise<void>;
}
const INITIAL: State = { enabled: false, mode: "off", revision: 0, canToggle: false };
const MaskContext = createContext<DisplayState>({ ...INITIAL, error: "", busy: false,
  refresh: async () => {}, toggle: async () => {} });

/** This state contains no person data and never touches the application query cache. */
export function MaskModeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(INITIAL);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const generation = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const refresh = useCallback(async () => {
    const token = ++generation.current;
    try {
      const response = await fetch("/api/mask-mode/state", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error();
      const next = await response.json();
      if (!["on", "off"].includes(next.mode) || typeof next.enabled !== "boolean") throw new Error();
      if (token !== generation.current) return;
      setState(next);
      setError("");
    } catch {
      if (token === generation.current) setError("Mask Mode state unavailable. Screen masking is not confirmed. Retry before recording.");
    } finally {
      if (token === generation.current) setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    channel.current = typeof BroadcastChannel === "function" ? new BroadcastChannel("sirius-screen-mask") : null;
    // Broadcast only an invalidation, never preferences/person data. Each tab
    // rereads its own cookie-bound login, so other logins cannot inherit state.
    const sync = () => void refresh();
    channel.current?.addEventListener("message", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    const timer = window.setInterval(sync, 5000);
    return () => {
      generation.current++;
      channel.current?.close();
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
      window.clearInterval(timer);
    };
  }, [refresh]);
  const toggle = async () => {
    if (busy || !state.canToggle) return;
    if (!window.confirm(state.mode === "on"
      ? "Turn screen masking OFF? Structured personal fields will be shown normally."
      : "Turn screen masking ON? Only structured personal displays are masked. Notes, files, photographs, messages, templates, raw browser data and downloads remain unchanged. This is not de-identification or a security certification.")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/mask-mode/state", {
        method: "POST", credentials: "same-origin",
        signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: state.mode === "on" ? "off" : "on", revision: state.revision }),
      });
      if (!response.ok) throw new Error();
      await refresh();
      channel.current?.postMessage("changed");
    } catch {
      await refresh();
      setError("Mask Mode change was not confirmed. Check the indicator and retry before recording.");
    } finally { setBusy(false); }
  };
  return <MaskContext.Provider value={{ ...state, error, busy, refresh, toggle }}>
    {loaded ? children : <div role="status" className="p-4">Checking screen masking preference…</div>}
    {error && <div role="alert" className="fixed right-2 top-2 z-[1001] max-w-md rounded border bg-background p-3 text-sm text-destructive shadow">
      {error} <button type="button" className="underline" onClick={() => void refresh()}>Retry</button>
    </div>}
    {state.mode === "on" && <div role="status" data-testid="mask-mode-on-indicator"
      className="pointer-events-none fixed bottom-2 left-2 z-[1000] rounded border bg-background px-3 py-1 text-xs font-bold shadow">
      Mask Mode ON — screen only
    </div>}
  </MaskContext.Provider>;
}

export const useMaskMode = () => useContext(MaskContext);

/** Use only at semantic personal-field displays, never matching/filtering or writes. */
export function PersonalText({ children, kind = "name" }: { children: ReactNode; kind?: PersonalField }) {
  const { mode } = useMaskMode();
  if (mode !== "on" || (typeof children !== "string" && typeof children !== "number")) return <>{children}</>;
  return <>{maskPersonal(children, kind)}</>;
}

export function usePersonalDisplay() {
  const { mode } = useMaskMode();
  return (value: string, kind: PersonalField = "name") => mode === "on" ? maskPersonal(value, kind) : value;
}

/** Polymorphic entity labels: only workers are people. Pass fallbacks separately. */
export function useWorkerEntityDisplay() {
  const personal = usePersonalDisplay();
  return (entityType: string, name: string | null | undefined, fallback: string) =>
    name == null ? fallback : (entityType === "worker" ? personal(name) : name);
}

export type PersonalFormatter = (value: any, kind: PersonalField) => any;
export function PersonalValue({ render }: { render: (mask: PersonalFormatter) => ReactNode }) {
  const { mode } = useMaskMode();
  const mask: PersonalFormatter = (value, kind) => mode === "on" &&
    (typeof value === "string" || typeof value === "number") ? maskPersonal(value, kind) : value;
  return <>{render(mask)}</>;
}

export function MaskModeControl() {
  const { enabled, mode, canToggle, busy, toggle } = useMaskMode();
  if (!enabled || (!canToggle && mode !== "on")) return null;

  const isOn = mode === "on";
  const label = isOn ? "Mask Mode ON — screen only" : "Mask Mode OFF";
  const disabled = busy || !canToggle;
  const Icon = isOn ? EyeOff : Eye;
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={`${isOn ? "text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300" : "text-muted-foreground"} ${disabled ? "pointer-events-none" : ""}`}
      data-testid="button-mask-mode"
      aria-label={label}
      aria-pressed={isOn}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={() => void toggle()}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </Button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled
          ? <span role="group" tabIndex={0} aria-label={label} title={label} className="inline-flex">{button}</span>
          : button}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}{busy ? " — updating" : ""}</TooltipContent>
    </Tooltip>
  );
}
