import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * `components/<component-id>/component.json`. The directory IS the component:
 * its name is the component ID, it holds exactly one component definition,
 * and deleting the directory removes the component.
 */
export interface OptionalComponentManifest {
  /**
   * Transitional: the component is still defined and registered by core
   * (`shared/components.ts`); the directory only holds files it wholly owns,
   * which core imports directly. Such a directory has no `definition` and may
   * list only its `schema` modules. See docs/optional-components.md.
   */
  coreRegistered?: boolean;
  /** Module exporting `component: ComponentDefinition` (exactly one). */
  definition?: string;
  shared?: string[];
  server?: string[];
  schema?: string[];
  migrations?: string[];
  startup?: string;
  storage?: string;
  metadata?: string;
  client?: string;
  contributions?: string;
  coreMigrations?: string[];
  maintenanceGuards?: Record<string, {
    handlerContainers: string[];
    handlerProperty: string;
    vendorIdentifiers: string[];
  }>;
}

const MANIFEST = "component.json";
const MANIFEST_FIELDS = new Set<string>([
  "coreRegistered", "definition", "shared", "server", "schema", "migrations", "startup", "storage",
  "metadata", "client", "contributions", "coreMigrations", "maintenanceGuards",
]);

export interface DiscoveredComponent {
  /** Component ID; always equal to the directory name. */
  id: string;
  /** Workspace-relative directory, e.g. `components/contract.chat`. */
  directory: string;
  /** True when core still defines and registers this component (see the manifest field). */
  coreRegistered: boolean;
  /** Every component ID this one declares a dependency on (core or optional). */
  dependsOn: string[];
  /** Definition module; absent for core-registered directories. */
  definition?: string;
  shared: string[];
  server: string[];
  schema: string[];
  migrations: string[];
  startup?: string;
  storage?: string;
  metadata?: string;
  client?: string;
  contributions?: string;
  coreMigrations: string[];
  maintenanceGuards: NonNullable<OptionalComponentManifest["maintenanceGuards"]>;
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

function objectProperty(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && propertyName(property.name) === name) return property.initializer;
  }
  return undefined;
}

function stringArray(expression: ts.Expression | undefined, where: string): string[] {
  if (!expression) return [];
  if (!ts.isArrayLiteralExpression(expression) || !expression.elements.every(ts.isStringLiteral)) {
    throw new Error(`${where}: dependsOnComponents must be a literal array of component IDs`);
  }
  return expression.elements.map(element => (element as ts.StringLiteral).text);
}

/**
 * Reads the ONE component a definition module declares, without executing it.
 * The module must export `const component = { id: "...", ... }`; a list export
 * (`components`) is rejected because a directory holds exactly one component.
 */
function readDefinition(path: string): { id: string; dependsOn: string[] } {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const found: ts.ObjectLiteralExpression[] = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) ||
      !statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      if (declaration.name.text === "components") {
        throw new Error(`${path} exports a "components" list. A component directory holds exactly one component: export "component" instead and move any other component into its own directory.`);
      }
      if (declaration.name.text !== "component") continue;
      let initializer = declaration.initializer;
      while (initializer && (ts.isSatisfiesExpression(initializer) || ts.isAsExpression(initializer) || ts.isParenthesizedExpression(initializer))) {
        initializer = initializer.expression;
      }
      if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
        throw new Error(`${path}: "component" must be an object literal`);
      }
      found.push(initializer);
    }
  }
  if (found.length !== 1) throw new Error(`${path} must export exactly one "component" definition (found ${found.length})`);
  const [object] = found;
  const id = objectProperty(object, "id");
  if (!id || !ts.isStringLiteral(id)) throw new Error(`${path}: component id must be a string literal`);
  return { id: id.text, dependsOn: declaredDependencies(object, path) };
}

function declaredDependencies(object: ts.ObjectLiteralExpression, where: string): string[] {
  const schemaManifest = objectProperty(object, "schemaManifest");
  return [...new Set([
    ...stringArray(objectProperty(object, "dependsOnComponents"), where),
    ...(schemaManifest && ts.isObjectLiteralExpression(schemaManifest)
      ? stringArray(objectProperty(schemaManifest, "dependsOnComponents"), where) : []),
  ])];
}

/** IDs of the components defined in core (`shared/components.ts`), not in `components/`. */
export function coreComponentIds(root = resolve(import.meta.dirname, "..")): Set<string> {
  return new Set(coreComponentDependencies(root).keys());
}

/** Core component IDs mapped to the component IDs each declares a dependency on. */
function coreComponentDependencies(root: string): Map<string, string[]> {
  const path = resolve(root, "shared/components.ts");
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const ids = new Map<string, string[]>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "componentRegistry" &&
      node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      for (const element of node.initializer.elements) {
        if (!ts.isObjectLiteralExpression(element)) continue;
        const id = objectProperty(element, "id");
        if (id && ts.isStringLiteral(id)) ids.set(id.text, declaredDependencies(element, path));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!ids.size) throw new Error(`Could not read the core component registry in ${path}`);
  return ids;
}

/**
 * Optional components: directories under `components/` that define and register
 * themselves. Build-time discovery only; runtime bundles contain literal
 * imports, never filesystem scans.
 */
export function discoverOptionalComponents(root = resolve(import.meta.dirname, "..")): DiscoveredComponent[] {
  return discoverComponentDirectories(root).filter(c => !c.coreRegistered);
}

/** Every directory under `components/`, including core-registered ones. */
export function discoverComponentDirectories(root = resolve(import.meta.dirname, "..")): DiscoveredComponent[] {
  const core = coreComponentDependencies(root);
  const directory = resolve(root, "components");
  if (!existsSync(directory)) return [];
  const discovered = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry): DiscoveredComponent => {
      const componentRoot = resolve(directory, entry.name);
      const where = `components/${entry.name}`;
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(entry.name)) {
        throw new Error(`${where}: a component directory must be named with its component ID`);
      }
      const manifestPath = resolve(componentRoot, MANIFEST);
      if (!existsSync(manifestPath)) throw new Error(`${where} has no ${MANIFEST}. Every directory under components/ is one component.`);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as OptionalComponentManifest;
      for (const key of Object.keys(manifest)) {
        if (!MANIFEST_FIELDS.has(key)) throw new Error(`${where}/${MANIFEST}: unknown field "${key}"`);
      }
      const modulePath = (path: string) => {
        if (typeof path !== "string") throw new Error(`Invalid contribution in ${where}/${MANIFEST}`);
        const absolute = resolve(componentRoot, path);
        if (!absolute.startsWith(componentRoot + sep) || !existsSync(absolute) || !statSync(absolute).isFile()) {
          throw new Error(`Component contribution must be an existing file inside ${where}: ${path}`);
        }
        return relative(root, absolute).split(sep).join("/");
      };
      if (manifest.coreRegistered !== undefined && manifest.coreRegistered !== true) {
        throw new Error(`${where}/${MANIFEST}: "coreRegistered" may only be true; omit it for an optional component`);
      }
      if (manifest.coreRegistered) {
        const extra = Object.keys(manifest).filter(key => key !== "coreRegistered" && key !== "schema");
        if (extra.length) {
          throw new Error(`${where}/${MANIFEST}: a core-registered component may list only "schema"; core still registers everything else (found ${extra.map(k => `"${k}"`).join(", ")})`);
        }
        if (!core.has(entry.name)) {
          throw new Error(`${where} is marked coreRegistered, but shared/components.ts defines no component "${entry.name}"`);
        }
        return {
          id: entry.name,
          directory: where,
          coreRegistered: true,
          dependsOn: core.get(entry.name)!,
          shared: [],
          server: [],
          schema: (manifest.schema ?? []).map(modulePath),
          migrations: [],
          coreMigrations: [],
          maintenanceGuards: {},
        };
      }
      if (!manifest.definition) throw new Error(`${where}/${MANIFEST} must name its "definition" module`);
      const definition = modulePath(manifest.definition);
      const { id, dependsOn } = readDefinition(resolve(root, definition));
      if (id !== entry.name) {
        throw new Error(`${where} defines component "${id}". The directory name must equal the component ID.`);
      }
      return {
        id,
        directory: where,
        coreRegistered: false,
        dependsOn,
        definition,
        shared: (manifest.shared ?? []).map(modulePath),
        server: (manifest.server ?? []).map(modulePath),
        schema: (manifest.schema ?? []).map(modulePath),
        migrations: (manifest.migrations ?? []).map(modulePath),
        startup: manifest.startup ? modulePath(manifest.startup) : undefined,
        storage: manifest.storage ? modulePath(manifest.storage) : undefined,
        metadata: manifest.metadata ? modulePath(manifest.metadata) : undefined,
        client: manifest.client ? modulePath(manifest.client) : undefined,
        contributions: manifest.contributions ? modulePath(manifest.contributions) : undefined,
        coreMigrations: (manifest.coreMigrations ?? []).map(modulePath),
        maintenanceGuards: Object.fromEntries(Object.entries(manifest.maintenanceGuards ?? {}).map(([path, guard]) => [modulePath(path), guard])),
      };
    });

  const optional = new Set(discovered.filter(c => !c.coreRegistered).map(c => c.id));
  for (const component of discovered) {
    if (component.coreRegistered) continue;
    if (core.has(component.id)) throw new Error(`components/${component.id} duplicates core component "${component.id}"`);
    for (const dependency of component.dependsOn) {
      if (core.has(dependency) || optional.has(dependency)) continue;
      throw new Error(`Component "${component.id}" depends on component "${dependency}", but components/${dependency} is not present. Restore it, or remove "${component.id}" too.`);
    }
  }
  return discovered;
}

/** Relative import specifiers of a module (static, dynamic, re-exports, `declare module`). */
function relativeSpecifiers(path: string): { specifier: string; line: number }[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const found: { specifier: string; line: number }[] = [];
  const add = (node: ts.Node, literal: ts.Node | undefined) => {
    if (literal && ts.isStringLiteralLike(literal) && literal.text.startsWith(".")) {
      found.push({ specifier: literal.text, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node, node.moduleSpecifier);
    else if (ts.isModuleDeclaration(node)) add(node, node.name);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require"))) add(node, node.arguments[0]);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node, node.argument.literal);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx|mts|cts)$/.test(entry.name) ? [path] : [];
  });
}

/** Core source roots checked for imports into `components/`. */
const CORE_SOURCE_ROOTS = ["client/src", "server", "shared", "scripts", "tests"];
/** Generated bridge modules, which may import any component. */
const GENERATED_DIRECTORIES = ["shared/generated", "server/generated", "client/src/generated"];
const GENERATED_FILES = ["scripts/migrate/generated-components.ts"];

/**
 * A component may import only from itself, from core, or from a component it
 * declares as a dependency. Core may import from a component directory only
 * while that component is core-registered (transitional); otherwise the
 * generated registration modules are the one bridge.
 */
export function checkComponentImports(root = resolve(import.meta.dirname, "..")): string[] {
  const components = discoverComponentDirectories(root);
  const byId = new Map(components.map(c => [c.id, c]));
  const componentsDirectory = resolve(root, "components") + sep;
  const violations: string[] = [];
  for (const component of components) {
    const allowed = new Set([component.id, ...component.dependsOn]);
    for (const file of sourceFiles(resolve(root, component.directory))) {
      for (const { specifier, line } of relativeSpecifiers(file)) {
        const target = resolve(dirname(file), specifier);
        if (!target.startsWith(componentsDirectory)) continue;
        const owner = target.slice(componentsDirectory.length).split(sep)[0];
        if (allowed.has(owner)) continue;
        const where = `${relative(root, file).split(sep).join("/")}:${line}`;
        violations.push(byId.has(owner)
          ? `${where} imports from component "${owner}", which "${component.id}" does not declare as a dependency.`
          : `${where} imports from components/${owner}, which is not a component "${component.id}" depends on.`);
      }
    }
  }
  const generated = GENERATED_DIRECTORIES.map(d => resolve(root, d) + sep);
  const generatedFiles = new Set(GENERATED_FILES.map(f => resolve(root, f)));
  for (const coreRoot of CORE_SOURCE_ROOTS) {
    const absoluteRoot = resolve(root, coreRoot);
    if (!existsSync(absoluteRoot)) continue;
    for (const file of sourceFiles(absoluteRoot)) {
      if (generatedFiles.has(file) || generated.some(d => file.startsWith(d))) continue;
      for (const { specifier, line } of relativeSpecifiers(file)) {
        const target = resolve(dirname(file), specifier);
        if (!target.startsWith(componentsDirectory)) continue;
        const owner = target.slice(componentsDirectory.length).split(sep)[0];
        if (byId.get(owner)?.coreRegistered) continue;
        violations.push(`${relative(root, file).split(sep).join("/")}:${line} imports from components/${owner}. Core may import only from core-registered component directories; reach an optional component through the generated registration modules.`);
      }
    }
  }
  return violations;
}

const GENERATED_HEADER = "// Generated by scripts/optional-components.ts; do not edit.\n";

export function generateOptionalComponents(root = resolve(import.meta.dirname, "..")) {
  const components = discoverOptionalComponents(root);
  const emit = (file: string, lines: string[]) => {
    const output = GENERATED_HEADER + lines.join("\n") + "\n";
    const path = resolve(root, file);
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path) || readFileSync(path, "utf8") !== output) writeFileSync(path, output);
  };
  const spec = (file: string, target: string) =>
    JSON.stringify("./" + relative(dirname(resolve(root, file)), resolve(root, target)).split(sep).join("/").replace(/\.tsx?$/, ""));

  const sharedFile = "shared/generated/optional-components.ts";
  emit(sharedFile, [
    'import type { ComponentDefinition } from "../components";',
    ...components.map((c, i) => `import { component as definition${i} } from ${spec(sharedFile, c.definition!)};`),
    `const discovered: [string, ComponentDefinition][] = [${components.map((c, i) => `[${JSON.stringify(c.id)}, definition${i}]`).join(", ")}];`,
    "for (const [directory, definition] of discovered) {",
    "  if (definition.id !== directory) throw new Error(`components/${directory} defines component ${definition.id}; the directory name must equal the component ID`);",
    "}",
    "/** Component definitions contributed by directories under components/. */",
    "export const optionalComponents: ComponentDefinition[] = discovered.map(([, definition]) => definition);",
    "/** IDs of the components whose source is present under components/. */",
    "export const optionalComponentIds: ReadonlySet<string> = new Set(discovered.map(([id]) => id));",
  ]);
  const sharedModulesFile = "shared/generated/component-modules.ts";
  emit(sharedModulesFile, components.flatMap(c => c.shared.map(path => `export * from ${spec(sharedModulesFile, path)};`)).concat("export {};"));
  const contributionsFile = "shared/generated/component-contributions.ts";
  const contributors = components.filter(c => c.contributions);
  emit(contributionsFile, [
    'import type { ComponentContributions } from "../component-contributions";',
    ...contributors.map((c, i) => `import { contributions as contribution${i} } from ${spec(contributionsFile, c.contributions!)};`),
    `export const componentContributions: ComponentContributions[] = [${contributors.map((_, i) => `contribution${i}`).join(", ")}];`,
  ]);
  const schemaFile = "shared/generated/component-schema.ts";
  emit(schemaFile, components.flatMap(c => c.schema.map(path => `export * from ${spec(schemaFile, path)};`)).concat("export {};"));
  const schemasFile = "server/generated/component-schemas.ts";
  emit(schemasFile, [
    "export const componentSchemaLoaders: Record<string, () => Promise<Record<string, unknown>>> = {",
    ...discoverComponentDirectories(root).flatMap(c => c.schema.map(path => `  ${JSON.stringify("./" + path)}: () => import(${spec(schemasFile, path)}),`)),
    "};",
  ]);
  const modulesFile = "server/generated/component-server-modules.ts";
  emit(modulesFile, components.flatMap(c => c.server.map(path => `import ${spec(modulesFile, path)};`)).concat("export {};"));
  const serverFile = "server/generated/component-startups.ts";
  const startups = components.filter(c => c.startup);
  emit(serverFile, [
    'import type { ComponentStartup } from "../services/component-startup-types";',
    'import "./component-server-modules";',
    ...startups.map((c, i) => `import * as startup${i} from ${spec(serverFile, c.startup!)};`),
    `export const componentStartups: ComponentStartup[] = [${startups.map((_, i) => `startup${i}`).join(", ")}];`,
  ]);
  const storageFile = "server/generated/component-storage.ts";
  const stores = components.filter(c => c.storage);
  emit(storageFile, [
    ...stores.map((c, i) => `import { createStorage as create${i} } from ${spec(storageFile, c.storage!)};`),
    `export function createComponentStorage() { return {${stores.map((_, i) => `...create${i}()`).join(", ")}}; }`,
    "export type ComponentStorage = ReturnType<typeof createComponentStorage>;",
  ]);
  const metadataFile = "server/generated/component-metadata.ts";
  const metadata = components.filter(c => c.metadata);
  emit(metadataFile, [
    ...metadata.map((c, i) => `import { metadataContexts as contexts${i} } from ${spec(metadataFile, c.metadata!)};`),
    `export const componentMetadataContexts = {${metadata.map((_, i) => `...contexts${i}`).join(", ")}};`,
  ]);
  const browserFile = "client/src/generated/component-contributions.ts";
  const clients = components.filter(c => c.client);
  emit(browserFile, [
    'import type { ComponentBrowserContributions } from "../lib/component-contributions";',
    ...clients.map((c, i) => `import { contributions as contribution${i} } from ${spec(browserFile, c.client!)};`),
    `export const componentBrowserContributions: ComponentBrowserContributions[] = [${clients.map((_, i) => `contribution${i}`).join(", ")}];`,
  ]);
  const migrationFile = "scripts/migrate/generated-components.ts";
  emit(migrationFile, components.flatMap(c => [...c.coreMigrations, ...c.migrations].map(path => `import ${spec(migrationFile, path)};`)).concat("export {};"));
  return components;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Discovered ${generateOptionalComponents().length} optional component(s)`);
}
