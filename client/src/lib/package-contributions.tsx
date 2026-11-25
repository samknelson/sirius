import type { ComponentType } from "react";
import type { InsertEdlsCrew } from "@shared/schema";
import type { NavItem } from "../config/navigation-registry";
import { packageBrowserContributions } from "../generated/component-packages";
import { useAuth } from "../contexts/AuthContext";

export interface CrewExtensionProps {
  crew: { data?: unknown; id?: string };
  index: number;
  onChange?: (data: InsertEdlsCrew["data"]) => void;
}
export interface PackageBrowserContributions {
  routes?: { path: string; page: ComponentType<any> }[];
  navigation?: { section: string; item: NavItem }[];
  crewUi?: { component: string; editor: ComponentType<CrewExtensionProps>; detail: ComponentType<CrewExtensionProps> }[];
}
export function CrewExtensions(props: CrewExtensionProps) {
  const { hasComponent } = useAuth();
  return <>{packageBrowserContributions.flatMap(p => p.crewUi ?? []).filter(p => hasComponent(p.component)).map((p, i) => {
    const View = props.onChange ? p.editor : p.detail;
    return <View key={i} {...props} />;
  })}</>;
}
