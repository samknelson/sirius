import type { ComponentType } from "react";
import type { InsertEdlsCrew } from "@shared/schema";
import type { NavItem, NavSection } from "../config/navigation-registry";
import { componentBrowserContributions } from "../generated/component-contributions";
import { useAuth } from "../contexts/AuthContext";

export interface CrewExtensionProps {
  crew: { data?: unknown; id?: string };
  index: number;
  onChange?: (data: InsertEdlsCrew["data"]) => void;
}
export interface ComponentBrowserContributions {
  routes?: { path: string; page: ComponentType<any> }[];
  configSections?: NavSection[];
  navigation?: { section: string; item: NavItem }[];
  crewUi?: { component: string; editor: ComponentType<CrewExtensionProps>; detail: ComponentType<CrewExtensionProps> }[];
}
export function CrewExtensions(props: CrewExtensionProps) {
  const { hasComponent } = useAuth();
  return <>{componentBrowserContributions.flatMap(p => p.crewUi ?? []).filter(p => hasComponent(p.component)).map((p, i) => {
    const View = props.onChange ? p.editor : p.detail;
    return <View key={i} {...props} />;
  })}</>;
}
