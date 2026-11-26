import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { contributions } from "../client/src/contributions";

vi.mock("../../../client/src/lib/component-routes", () => ({
  componentTabRoute: (page: unknown) => page,
}));

// Use the actual host pages, rather than assuming the edit and create forms
// mount the same slots. Rendering a participant in both edit slots is invalid.
it.each(["job-new", "job-edit"])("mounts skills exactly once in %s's actual slot composition", page => {
  const file = new URL(`../../../client/src/pages/dispatch/${page}.tsx`, import.meta.url);
  const source = ts.createSourceFile(page, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const slots: ("jobForm" | "jobSettings" | "jobTypeForm")[] = [];
  function visit(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      && node.tagName.getText(source) === "DispatchFormExtensions") {
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText(source) !== "slot"
          || !attribute.initializer || !ts.isStringLiteral(attribute.initializer)) continue;
        const slot = attribute.initializer.text;
        if (slot === "jobForm" || slot === "jobSettings" || slot === "jobTypeForm") slots.push(slot);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(slots).toContain("jobForm");
  if (page === "job-edit") expect(slots).toContain("jobSettings");
  const mountedSkills = slots.flatMap(slot =>
    (contributions.dispatchUi ?? []).filter(contribution =>
      contribution.component === "worker.skills" && contribution[slot]),
  );
  expect(mountedSkills).toHaveLength(1);
});
