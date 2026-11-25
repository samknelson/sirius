import { Suspense, type ComponentType } from "react";
import type { InsertEdlsCrew } from "@shared/schema";
import type { NavItem, NavSection } from "../config/navigation-registry";
import { componentBrowserContributions } from "../generated/component-contributions";
import { useAuth } from "../contexts/AuthContext";
import type { DispatchUiContribution } from "./dispatch-contributions";

export interface CrewExtensionProps {
  crew: { data?: unknown; id?: string };
  index: number;
  onChange?: (data: InsertEdlsCrew["data"]) => void;
}
export interface ComponentBrowserContributions {
  dispatchUi?: DispatchUiContribution[];
  /** Headless observers owned by removable components (e.g. identity cleanup). */
  lifecycle?: ComponentType[];
  routes?: { path: string; page: ComponentType<any>; layout?: "bare" }[];
  configSections?: NavSection[];
  navigation?: { section: string; before?: string; item: NavItem }[];
  /**
   * Sections a component places in a named slot of another component's page,
   * so a parent page never imports its dependents. Rendered only while
   * `component` is enabled; lazy-load the section.
   */
  slots?: { slot: string; component: string; section: ComponentType<any> }[];
  crewUi?: { component: string; editor: ComponentType<CrewExtensionProps>; detail: ComponentType<CrewExtensionProps> }[];
}
export function CrewExtensions(props: CrewExtensionProps) {
  const { hasComponent } = useAuth();
  return <>{componentBrowserContributions.flatMap(p => p.crewUi ?? []).filter(p => hasComponent(p.component)).map((p, i) => {
    const View = props.onChange ? p.editor : p.detail;
    return <View key={i} {...props} />;
  })}</>;
}

/** Renders every enabled component's section for a named page slot, in contribution order. */
export function ComponentSlot<Props extends object>({ name, props }: { name: string; props: Props }) {
  const { hasComponent } = useAuth();
  const sections = componentBrowserContributions
    .flatMap(p => p.slots ?? [])
    .filter(s => s.slot === name && hasComponent(s.component));
  return <Suspense fallback={null}>{sections.map(({ section: Section }, i) => <Section key={i} {...props} />)}</Suspense>;
}
