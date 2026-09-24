import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

type InjectionSlot = "head" | "bodyEnd";
type InjectionKind = "js-src" | "js-inline" | "css-href" | "css-inline";

interface ResolvedInjection {
  id: string;
  slot: InjectionSlot;
  kind: InjectionKind;
  src?: string;
  code?: string;
  attrs?: Record<string, string | boolean>;
  order: number;
}

interface ResolvedInjectionManifest {
  head: ResolvedInjection[];
  bodyEnd: ResolvedInjection[];
}

// Stable layout-region CSS ids (public contract for deployment-specific
// client-injection CSS — do not rename casually):
//   #site-header      — the whole <header> wrapper (banner + menu)
//   #site-banner      — top header row (site name / user menu bar)
//   #site-menu        — desktop main navigation row
//   #site-menu-mobile — mobile navigation sheet content
//   #site-title       — page title area (PageHeader region with the h1)
//   #site-content     — main body/content area (<main>)
//   #site-footer      — footer
// Example injected CSS: #site-banner { background-color: #3333cc; }
const DATA_ATTR = "data-client-injection-id";

function applyAttrs(el: HTMLElement, attrs?: Record<string, string | boolean>) {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    if (v === true) {
      el.setAttribute(k, "");
    } else {
      el.setAttribute(k, String(v));
    }
  }
}

function buildElement(entry: ResolvedInjection): HTMLElement | null {
  let el: HTMLElement | null = null;
  switch (entry.kind) {
    case "js-src": {
      if (!entry.src) return null;
      const script = document.createElement("script");
      script.src = entry.src;
      script.async = false;
      el = script;
      break;
    }
    case "js-inline": {
      if (!entry.code) return null;
      const script = document.createElement("script");
      script.text = entry.code;
      el = script;
      break;
    }
    case "css-href": {
      if (!entry.src) return null;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = entry.src;
      el = link;
      break;
    }
    case "css-inline": {
      if (!entry.code) return null;
      const style = document.createElement("style");
      style.textContent = entry.code;
      el = style;
      break;
    }
  }
  if (el) {
    applyAttrs(el, entry.attrs);
    el.setAttribute(DATA_ATTR, entry.id);
  }
  return el;
}

function appendOnce(parent: HTMLElement, entry: ResolvedInjection) {
  if (document.querySelector(`[${DATA_ATTR}="${CSS.escape(entry.id)}"]`)) return;
  const el = buildElement(entry);
  if (el) parent.appendChild(el);
}

export function ServerInjections() {
  const { data } = useQuery<ResolvedInjectionManifest>({
    queryKey: ["/api/plugins/client-injection/resolved"],
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    if (!data) return;
    for (const entry of data.head) appendOnce(document.head, entry);
    for (const entry of data.bodyEnd) appendOnce(document.body, entry);
  }, [data]);

  return null;
}

export default ServerInjections;
