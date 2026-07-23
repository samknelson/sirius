/**
 * Guard: resolving a nonexistent plugin component id from
 * createPluginComponentRegistry must return a renderable fallback
 * component (never throw). A regression here white-screens
 * /wizards/:id when a plugin declares a component with no matching
 * file.
 *
 * Run: npx tsx scripts/dev/check-plugin-component-fallback.ts
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createPluginComponentRegistry } from "../../client/src/plugins/_core/registry";

let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

function main() {
  console.log("check-plugin-component-fallback");

  const registry = createPluginComponentRegistry<Record<string, never>>({
    kind: "wizards",
    glob: {},
  });

  check(
    "has() is false for a nonexistent id",
    registry.has("ghost-plugin:GhostStep") === false,
  );

  let component: ReturnType<typeof registry.resolve> | undefined;
  let threw: unknown;
  const originalError = console.error;
  console.error = () => {};
  try {
    component = registry.resolve("ghost-plugin:GhostStep");
  } catch (err) {
    threw = err;
  } finally {
    console.error = originalError;
  }

  check(
    "resolve() of a nonexistent id does not throw",
    threw === undefined,
    threw instanceof Error ? threw.message : String(threw),
  );
  check(
    "resolve() returns a component function",
    typeof component === "function",
  );

  if (typeof component === "function") {
    let html = "";
    let renderErr: unknown;
    try {
      html = renderToStaticMarkup(createElement(component, {}));
    } catch (err) {
      renderErr = err;
    }
    check(
      "fallback component renders without throwing",
      renderErr === undefined,
      renderErr instanceof Error ? renderErr.message : String(renderErr),
    );
    check(
      "rendered output contains the inline error text",
      html.includes(
        'This view failed to load: component &quot;GhostStep&quot; is missing.',
      ),
      html.slice(0, 300),
    );
    check(
      "rendered output names the declaring plugin and expected file",
      html.includes("ghost-plugin") &&
        html.includes("client/src/plugins/wizards/ghost-plugin/GhostStep.tsx"),
      html.slice(0, 300),
    );
    check(
      "rendered output carries the error test id",
      html.includes(
        'data-testid="error-missing-plugin-component-ghost-plugin-GhostStep"',
      ),
      html.slice(0, 300),
    );
  }

  const realRegistry = createPluginComponentRegistry<{ label: string }>({
    kind: "wizards",
    glob: {
      "./demo-plugin/DemoStep.tsx": {
        DemoStep: (props: { label: string }) =>
          createElement("span", null, props.label),
      },
    },
  });
  check(
    "registered components still resolve to the real component",
    renderToStaticMarkup(
      createElement(realRegistry.resolve("demo-plugin:DemoStep"), {
        label: "hello",
      }),
    ) === "<span>hello</span>",
  );

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main();
