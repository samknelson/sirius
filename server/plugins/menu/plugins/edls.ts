import { registerMenuPlugin } from "../registry";
import type { MenuItemDef } from "../types";
import {
  buildConfigMenuItem,
  buildDefaultMenuTree,
  buildEdlsMenuItems,
  buildUsersMenuItem,
} from "./default";

/**
 * The `edls` menu plugin: an EDLS-focused navigation for deployments where
 * daily labor sheets are the primary activity. It promotes the EDLS links
 * (Sheets, Absences, Crew Leads) to top level and keeps the Workers, Users,
 * and Configuration entries from the default menu. Item gates are identical
 * to the default plugin, so nobody sees a link they couldn't see before.
 */
function buildEdlsMenuTree(): MenuItemDef[] {
  const defaults = buildDefaultMenuTree();
  const pick = (id: string): MenuItemDef | undefined =>
    defaults.find((item) => item.id === id);

  const items: MenuItemDef[] = [];

  const home = pick("home");
  if (home) items.push(home);

  // Personal items stay so worker/employer-portal users keep their links.
  for (const id of ["my-worker", "my-qr-code", "my-employers", "employer-dispatch", "my-dispatches"]) {
    const item = pick(id);
    if (item) items.push(item);
  }

  // Promote the EDLS links to top level, still gated on the edls component
  // plus each link's own policy gate.
  for (const edlsItem of buildEdlsMenuItems()) {
    items.push({
      ...edlsItem,
      testId: `nav-${edlsItem.id}`,
      gate: edlsItem.gate
        ? { allOf: [{ component: "edls" }, edlsItem.gate] }
        : { component: "edls" },
    });
  }

  const workers = pick("workers");
  if (workers) items.push(workers);

  items.push(buildUsersMenuItem());
  items.push(buildConfigMenuItem());

  return items;
}

registerMenuPlugin({
  metadata: {
    id: "edls",
    name: "EDLS",
    description:
      "EDLS-focused navigation: Sheets, Absences, and Crew Leads at top level, plus Workers, Users, and Configuration.",
  },
  buildTree: buildEdlsMenuTree,
});
