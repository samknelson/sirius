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
  /** Synchronous, self-contained classic scripts placed before document resources. */
  earlyDocument?: string[];
  /** Modules exporting initialize(), called before the browser mounts React. */
  initializers?: string[];
  documentPolicies?: { path: string; referrerPolicy: "no-referrer"; cacheControl: "private, no-store" }[];
  contributions?: string;
  coreMigrations?: string[];
  /** JSON declarations consumed only by development architecture checks. */
  developerChecks?: string;
  maintenanceGuards?: Record<string, {
    handlerContainers: string[];
    handlerProperty: string;
    vendorIdentifiers: string[];
  } | {
    /** Standalone infrastructure still uses the shared maintenance refusal. */
    standaloneExemptions: Record<string, string>;
  }>;
}

const MANIFEST = "component.json";
const MANIFEST_FIELDS = new Set<string>([
  "coreRegistered", "definition", "shared", "server", "schema", "migrations", "startup", "storage",
  "metadata", "client", "contributions", "coreMigrations", "maintenanceGuards", "earlyDocument", "initializers", "documentPolicies", "developerChecks",
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
  /** Tables this component's schema manifest declares it owns. */
  tables: string[];
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
  earlyDocument: string[];
  initializers: string[];
  documentPolicies: NonNullable<OptionalComponentManifest["documentPolicies"]>;
  contributions?: string;
  coreMigrations: string[];
  developerChecks?: string;
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
function readDefinition(path: string): { id: string } & DeclaredComponent {
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
  return { id: id.text, dependsOn: declaredDependencies(object, path), tables: declaredTables(object), schemaPath: declaredSchemaPath(object) };
}

/**
 * A component declares its dependencies in exactly one place: the top-level
 * `dependsOnComponents` of its definition. The old nested
 * `schemaManifest.dependsOnComponents` is refused so the two cannot drift.
 */
function declaredDependencies(object: ts.ObjectLiteralExpression, where: string): string[] {
  const schemaManifest = objectProperty(object, "schemaManifest");
  if (schemaManifest && ts.isObjectLiteralExpression(schemaManifest) && objectProperty(schemaManifest, "dependsOnComponents")) {
    throw new Error(`${where}: declare dependencies in the component's top-level "dependsOnComponents", not in schemaManifest`);
  }
  const dependencies = stringArray(objectProperty(object, "dependsOnComponents"), where);
  if (new Set(dependencies).size !== dependencies.length) throw new Error(`${where}: dependsOnComponents lists a component twice`);
  return dependencies;
}

/** Declared table names of a definition's schema manifest (literal strings only). */
function declaredTables(object: ts.ObjectLiteralExpression): string[] {
  const schemaManifest = objectProperty(object, "schemaManifest");
  if (!schemaManifest || !ts.isObjectLiteralExpression(schemaManifest)) return [];
  const tables = objectProperty(schemaManifest, "tables");
  if (!tables || !ts.isArrayLiteralExpression(tables)) return [];
  return tables.elements.filter(ts.isStringLiteral).map(element => element.text);
}

/** IDs of the components defined in core (`shared/components.ts`), not in `components/`. */
export function coreComponentIds(root = resolve(import.meta.dirname, "..")): Set<string> {
  return new Set(coreComponentDeclarations(root).keys());
}

interface DeclaredComponent {
  dependsOn: string[];
  /** Tables the component's schema manifest declares it owns. */
  tables: string[];
  /** Workspace-relative schema module named by `schemaManifest.schemaPath`, if any. */
  schemaPath?: string;
}

function declaredSchemaPath(object: ts.ObjectLiteralExpression): string | undefined {
  const schemaManifest = objectProperty(object, "schemaManifest");
  if (!schemaManifest || !ts.isObjectLiteralExpression(schemaManifest)) return undefined;
  const path = objectProperty(schemaManifest, "schemaPath");
  return path && ts.isStringLiteral(path) ? path.text.replace(/^\.\//, "") : undefined;
}

/** Core component IDs mapped to their single dependency list and declared tables. */
function coreComponentDeclarations(root: string): Map<string, DeclaredComponent> {
  const path = resolve(root, "shared/components.ts");
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const ids = new Map<string, DeclaredComponent>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "componentRegistry" &&
      node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      for (const element of node.initializer.elements) {
        if (!ts.isObjectLiteralExpression(element)) continue;
        const id = objectProperty(element, "id");
        if (!id || !ts.isStringLiteral(id)) continue;
        ids.set(id.text, {
          dependsOn: declaredDependencies(element, `${path} (component "${id.text}")`),
          tables: declaredTables(element),
          schemaPath: declaredSchemaPath(element),
        });
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
  const core = coreComponentDeclarations(root);
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
          dependsOn: core.get(entry.name)!.dependsOn,
          tables: core.get(entry.name)!.tables,
          shared: [],
          server: [],
          earlyDocument: [],
          initializers: [],
          documentPolicies: [],
          schema: (manifest.schema ?? []).map(modulePath),
          migrations: [],
          coreMigrations: [],
          maintenanceGuards: {},
        };
      }
      if (!manifest.definition) throw new Error(`${where}/${MANIFEST} must name its "definition" module`);
      const definition = modulePath(manifest.definition);
      const { id, dependsOn, tables } = readDefinition(resolve(root, definition));
      if (id !== entry.name) {
        throw new Error(`${where} defines component "${id}". The directory name must equal the component ID.`);
      }
      return {
        id,
        directory: where,
        coreRegistered: false,
        dependsOn,
        tables,
        definition,
        shared: (manifest.shared ?? []).map(modulePath),
        server: (manifest.server ?? []).map(modulePath),
        schema: (manifest.schema ?? []).map(modulePath),
        migrations: (manifest.migrations ?? []).map(modulePath),
        startup: manifest.startup ? modulePath(manifest.startup) : undefined,
        storage: manifest.storage ? modulePath(manifest.storage) : undefined,
        metadata: manifest.metadata ? modulePath(manifest.metadata) : undefined,
        client: manifest.client ? modulePath(manifest.client) : undefined,
        earlyDocument: (manifest.earlyDocument ?? []).map(modulePath),
        initializers: (manifest.initializers ?? []).map(modulePath),
        documentPolicies: (manifest.documentPolicies ?? []).map(policy => {
          if (!/^\/[^?#]*$/.test(policy.path) || policy.referrerPolicy !== "no-referrer" ||
              policy.cacheControl !== "private, no-store") {
            throw new Error(`${where}/${MANIFEST}: invalid document privacy policy`);
          }
          return policy;
        }),
        contributions: manifest.contributions ? modulePath(manifest.contributions) : undefined,
        coreMigrations: (manifest.coreMigrations ?? []).map(modulePath),
        developerChecks: manifest.developerChecks ? modulePath(manifest.developerChecks) : undefined,
        maintenanceGuards: Object.fromEntries(Object.entries(manifest.maintenanceGuards ?? {}).map(([path, guard]) => [modulePath(path), guard])),
      };
    });

  checkDependencyPresence(core, discovered);
  return discovered;
}

/**
 * The build-time presence rule, applied to EVERY component (core-defined or in
 * its own directory) from the same single `dependsOnComponents` list the
 * enable flow reads:
 * - a core component may depend only on core components (core is always
 *   present; an optional directory may be deleted);
 * - an optional component may depend on core or on another PRESENT optional
 *   component;
 * - a dependency on an unknown ID, on itself, or a dependency cycle is refused.
 */
function checkDependencyPresence(core: Map<string, DeclaredComponent>, discovered: DiscoveredComponent[]): void {
  const optional = new Map(discovered.filter(c => !c.coreRegistered).map(c => [c.id, c]));
  const graph = new Map<string, string[]>();
  for (const [id, declaration] of core) {
    graph.set(id, declaration.dependsOn);
    for (const dependency of declaration.dependsOn) {
      if (dependency === id) throw new Error(`Core component "${id}" lists itself in dependsOnComponents`);
      if (core.has(dependency)) continue;
      if (optional.has(dependency)) {
        throw new Error(`Core component "${id}" depends on optional component "${dependency}". Core is always present but components/${dependency} may be deleted: gate the link at runtime instead, or move "${id}" into its own component directory.`);
      }
      throw new Error(`Core component "${id}" depends on component "${dependency}", which is not a known component. Fix the ID, or restore components/${dependency}.`);
    }
  }
  for (const component of optional.values()) {
    if (core.has(component.id)) throw new Error(`components/${component.id} duplicates core component "${component.id}"`);
    graph.set(component.id, component.dependsOn);
    for (const dependency of component.dependsOn) {
      if (dependency === component.id) throw new Error(`Component "${component.id}" lists itself in dependsOnComponents`);
      if (core.has(dependency) || optional.has(dependency)) continue;
      throw new Error(`Component "${component.id}" depends on component "${dependency}", but components/${dependency} is not present. Restore it, or remove "${component.id}" too.`);
    }
  }
  const done = new Set<string>();
  const visit = (id: string, path: string[]): void => {
    if (done.has(id)) return;
    if (path.includes(id)) throw new Error(`Component dependency cycle: ${[...path.slice(path.indexOf(id)), id].join(" -> ")}`);
    for (const dependency of graph.get(id) ?? []) visit(dependency, [...path, id]);
    done.add(id);
  };
  for (const id of graph.keys()) visit(id, []);
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

/** Drizzle table variables (`const x = pgTable("name", ...)`) declared in a module. */
function drizzleTableVariables(path: string): Map<string, string> {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const tables = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
      ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === "pgTable" && node.initializer.arguments[0] &&
      ts.isStringLiteral(node.initializer.arguments[0])) {
      tables.set(node.name.text, node.initializer.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return tables;
}

/** SQL keywords that are followed by a table name. */
const RAW_SQL_TABLE = /\b(?:from|join|into|update|references|truncate|table(?:\s+if\s+(?:not\s+)?exists)?)\s+(?:only\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/gi;

interface TableReference { table: string; line: number; kind: "foreign key" | "raw SQL" | "query" }

/**
 * Cross-table references in one module: foreign keys (`.references(() => t.col)`
 * and `foreignKey({ foreignColumns: [t.col] })`, resolved through the Drizzle
 * table-variable map) and table names in SQL text (string and template
 * literals, including drizzle `sql` templates and raw migration DDL).
 */
function tableReferences(path: string, tableVariables: Map<string, string>, knownTables: Set<string>): TableReference[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const found: TableReference[] = [];
  const line = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const foreignTable = (expression: ts.Expression | undefined, at: ts.Node) => {
    while (expression && (ts.isArrowFunction(expression) || ts.isParenthesizedExpression(expression))) {
      expression = ts.isArrowFunction(expression) && !ts.isBlock(expression.body) ? expression.body
        : ts.isParenthesizedExpression(expression) ? expression.expression : undefined;
    }
    if (expression && ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
      const table = tableVariables.get(expression.expression.text);
      if (table) found.push({ table, line: line(at), kind: "foreign key" });
    }
  };
  const sqlText = (text: string, at: ts.Node) => {
    for (const match of text.matchAll(RAW_SQL_TABLE)) {
      const table = match[1].toLowerCase();
      if (knownTables.has(table)) found.push({ table, line: line(at), kind: "raw SQL" });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "references") {
      foreignTable(node.arguments[0], node);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "foreignKey" &&
      node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
      const columns = objectProperty(node.arguments[0], "foreignColumns");
      if (columns && ts.isArrayLiteralExpression(columns)) columns.elements.forEach(column => foreignTable(column, node));
    } else if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      // A Drizzle table imported by name is used to query that table.
      for (const element of node.importClause.namedBindings.elements) {
        const table = tableVariables.get((element.propertyName ?? element.name).text);
        if (table && !element.isTypeOnly && !node.importClause.isTypeOnly) found.push({ table, line: line(node), kind: "query" });
      }
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      sqlText(node.text, node);
    } else if (ts.isTemplateExpression(node)) {
      // Join the literal parts so a keyword and its table may straddle nothing
      // but whitespace; interpolations break the match.
      sqlText([node.head.text, ...node.templateSpans.map(span => span.literal.text)].join(" ${} "), node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Workspace-relative schema modules declared by any component or core. */
function schemaModules(root: string): string[] {
  const roots = [resolve(root, "shared/schema"), resolve(root, "components")];
  return roots.filter(existsSync).flatMap(sourceFiles)
    .filter(file => file.includes(`${sep}shared${sep}schema${sep}`) || file.startsWith(resolve(root, "shared/schema") + sep));
}

export interface ComponentTableLink {
  /** Component whose source holds the reference; `null` for core (non-component) source. */
  from: string | null;
  /** Component that declares the referenced table. */
  owner: string;
  table: string;
  kind: TableReference["kind"];
  /** Workspace-relative `file:line`. */
  where: string;
  /** True when `owner` is `from` itself or one of its declared dependencies. */
  declared: boolean;
}

/** Core source roots scanned (informationally) for references into component tables. */
const CORE_TABLE_LINK_ROOTS = ["server", "shared", "scripts", "client/src"];

/**
 * Every reference from one component's source (its directory, plus a core
 * component's declared schema module) or from core source to a table another
 * component declares in its schema manifest. Table ownership is each
 * component's declared `schemaManifest.tables`; a table no component declares
 * is core and never reported. Kinds: `foreign key` (`.references()` /
 * `foreignKey()`), `raw SQL` (a table named after FROM/JOIN/INTO/UPDATE/
 * REFERENCES/TABLE in any string or template literal) and `query` (a Drizzle
 * table imported by name).
 */
export function auditComponentTableLinks(root = resolve(import.meta.dirname, "..")): ComponentTableLink[] {
  const core = coreComponentDeclarations(root);
  const directories = discoverComponentDirectories(root);
  const owners = new Map<string, string>();
  const declare = (id: string, tables: string[]) => {
    for (const table of tables) {
      const existing = owners.get(table);
      if (existing && existing !== id) throw new Error(`Table "${table}" is declared by both "${existing}" and "${id}"`);
      owners.set(table, id);
    }
  };
  for (const [id, declaration] of core) declare(id, declaration.tables);
  for (const component of directories) declare(component.id, component.tables);

  const tableVariables = new Map<string, string>();
  for (const file of schemaModules(root)) {
    for (const [name, table] of drizzleTableVariables(file)) {
      // Ambiguous variable names resolve to nothing rather than to a guess.
      tableVariables.set(name, tableVariables.has(name) && tableVariables.get(name) !== table ? "" : table);
    }
  }
  for (const [name, table] of tableVariables) if (!table) tableVariables.delete(name);
  const knownTables = new Set(owners.keys());
  const display = (file: string) => relative(root, file).split(sep).join("/");

  const scopes = new Map<string, { files: Set<string>; dependsOn: string[] }>();
  for (const [id, declaration] of core) {
    const files = new Set<string>();
    if (declaration.schemaPath && existsSync(resolve(root, declaration.schemaPath))) files.add(resolve(root, declaration.schemaPath));
    scopes.set(id, { files, dependsOn: declaration.dependsOn });
  }
  for (const component of directories) {
    const scope = scopes.get(component.id) ?? { files: new Set<string>(), dependsOn: component.dependsOn };
    for (const file of sourceFiles(resolve(root, component.directory))) scope.files.add(file);
    scopes.set(component.id, scope);
  }

  const links: ComponentTableLink[] = [];
  const collect = (from: string | null, file: string, allowed: Set<string>) => {
    const seen = new Set<string>();
    for (const reference of tableReferences(file, tableVariables, knownTables)) {
      const owner = owners.get(reference.table);
      if (!owner || owner === from) continue;
      const where = `${display(file)}:${reference.line}`;
      const key = `${where}:${reference.table}:${reference.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ from, owner, table: reference.table, kind: reference.kind, where, declared: allowed.has(owner) });
    }
  };
  const attributed = new Set<string>();
  for (const [id, scope] of scopes) {
    const allowed = new Set([id, ...scope.dependsOn]);
    for (const file of scope.files) {
      attributed.add(file);
      collect(id, file, allowed);
    }
  }
  const generated = GENERATED_DIRECTORIES.map(d => resolve(root, d) + sep);
  for (const coreRoot of CORE_TABLE_LINK_ROOTS) {
    const absoluteRoot = resolve(root, coreRoot);
    if (!existsSync(absoluteRoot)) continue;
    for (const file of sourceFiles(absoluteRoot)) {
      if (attributed.has(file) || generated.some(d => file.startsWith(d))) continue;
      collect(null, file, new Set());
    }
  }
  return links;
}

/**
 * Undeclared hard dependencies through the database, reported by the
 * `component-imports` developer check alongside import violations:
 * - a component with a foreign key into, or raw SQL naming, another
 *   component's declared table without declaring that component;
 * - a core schema module with a foreign key into any component's table (core
 *   cannot depend on a component).
 * Drizzle `query` imports and core raw SQL are left to the audit
 * (docs/component-dependencies.md): many are runtime-gated soft links that a
 * static check cannot tell apart from hard ones.
 */
export function checkComponentTableReferences(root = resolve(import.meta.dirname, "..")): string[] {
  const schemas = new Set(schemaModules(root).map(file => relative(root, file).split(sep).join("/")));
  return auditComponentTableLinks(root).flatMap(link => {
    if (link.declared || link.kind === "query") return [];
    if (link.from !== null) {
      return [`${link.where} has a ${link.kind} reference to table "${link.table}" of component "${link.owner}". Declare "${link.owner}" in "${link.from}" dependsOnComponents, or remove the reference.`];
    }
    if (link.kind !== "foreign key" || !schemas.has(link.where.replace(/:\d+$/, ""))) return [];
    return [`${link.where} is a core schema module with a foreign key into table "${link.table}" of component "${link.owner}". Core cannot depend on a component; move the table into a component that declares the dependency.`];
  });
}

/** Component-local exceptions retain the same stale-entry checks as core ones. */
export function readComponentDeveloperChecks(root = resolve(import.meta.dirname, "..")) {
  const result = {
    provenanceColumns: {} as Record<string, string>,
    storageEncapsulationBaseline: {} as Record<string, string>,
    readOnlyFlagExemptFiles: [] as string[],
  };
  for (const component of discoverOptionalComponents(root)) {
    if (!component.developerChecks) continue;
    const declaration = JSON.parse(readFileSync(resolve(root, component.developerChecks), "utf8"));
    for (const key of Object.keys(declaration)) {
      if (!Object.hasOwn(result, key)) throw new Error(`Unknown developer check declaration '${key}'`);
    }
    const localFile = (file: string) => {
      const absolute = resolve(root, component.directory, file);
      if (!absolute.startsWith(resolve(root, component.directory) + sep) || !existsSync(absolute)) {
        throw new Error(`Invalid developer check file in '${component.id}'`);
      }
      return relative(root, absolute).split(sep).join("/");
    };
    for (const key of ["provenanceColumns", "storageEncapsulationBaseline"] as const) {
      const values = declaration[key] ?? {};
      if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error(`Invalid '${key}' declaration`);
      for (const [name, reason] of Object.entries(values)) {
        if (typeof reason !== "string" || !reason.trim()) throw new Error(`Missing '${key}' reason`);
        const target = key === "storageEncapsulationBaseline" ? localFile(name) : name;
        if (Object.hasOwn(result[key], target)) throw new Error(`Duplicate developer check exception '${target}'`);
        result[key][target] = reason;
      }
    }
    const files = declaration.readOnlyFlagExemptFiles ?? [];
    if (!Array.isArray(files) || !files.every(f => typeof f === "string")) throw new Error("Invalid read-only exception files");
    result.readOnlyFlagExemptFiles.push(...files.map(localFile));
  }
  return result;
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
  emit("server/generated/component-document-policies.ts", [
    `export const componentDocumentPolicies: readonly { path: string; referrerPolicy: string; cacheControl: string }[] = ${JSON.stringify(components.flatMap(c => c.documentPolicies))};`,
  ]);
  const serverFile = "server/generated/component-startups.ts";
  const startups = components.filter(c => c.startup);
  emit(serverFile, [
    'import type { ComponentStartup } from "../services/component/startup-types";',
    'import "./component-server-modules";',
    ...startups.map((c, i) => `import * as startup${i} from ${spec(serverFile, c.startup!)};`),
    `export const componentStartups: ComponentStartup[] = [${startups.map((_, i) => `startup${i}`).join(", ")}];`,
  ]);
  const storageFile = "server/generated/component-storage.ts";
  const stores = components.filter(c => c.storage);
  emit(storageFile, [
    'import type { PluginConfigSubsidiaryDescriptor } from "../storage/system/plugin-configs-subsidiary";',
    ...stores.map((c, i) => `import { createStorage as create${i} } from ${spec(storageFile, c.storage!)};`),
    ...stores.map((c, i) => `import * as storage${i} from ${spec(storageFile, c.storage!)};`),
    `export const componentPluginConfigSubsidiaries: readonly PluginConfigSubsidiaryDescriptor[] = [${stores.map((_, i) => `...((storage${i} as { pluginConfigSubsidiaries?: readonly PluginConfigSubsidiaryDescriptor[] }).pluginConfigSubsidiaries ?? [])`).join(", ")}];`,
    `export function createComponentStorage() { return {${stores.map((_, i) => `...create${i}()`).join(", ")}}; }`,
    "export type ComponentStorage = ReturnType<typeof createComponentStorage>;",
  ]);
  const metadataFile = "server/generated/component-metadata.ts";
  const metadata = components.filter(c => c.metadata);
  emit(metadataFile, [
    'import type { MetadataRecordContext } from "../storage/entity-metadata-record-tables";',
    ...metadata.map((c, i) => `import * as metadata${i} from ${spec(metadataFile, c.metadata!)};`),
    "export const componentMetadataContexts: Record<string, MetadataRecordContext> = {};",
    `for (const contexts of [${metadata.map((_, i) => `metadata${i}.metadataContexts`).join(", ")}] as Record<string, MetadataRecordContext>[]) {`,
    "  for (const [id, declaration] of Object.entries(contexts)) {",
    '    if (Object.hasOwn(componentMetadataContexts, id)) throw new Error(`Duplicate component metadata context: ${id}`);',
    "    componentMetadataContexts[id] = declaration;",
    "  }",
    "}",
    "/** Tables a component's metadata module excludes from record history; holds while the component is disabled. */",
    `export const componentExcludedMetadataTables: readonly string[] = [${metadata.map((_, i) => `...((metadata${i} as { excludedTables?: readonly string[] }).excludedTables ?? [])`).join(", ")}];`,
  ]);
  const browserFile = "client/src/generated/component-contributions.ts";
  const clients = components.filter(c => c.client);
  emit(browserFile, [
    'import type { ComponentBrowserContributions } from "../lib/component-contributions";',
    ...clients.map((c, i) => `import { contributions as contribution${i} } from ${spec(browserFile, c.client!)};`),
    `export const componentBrowserContributions: ComponentBrowserContributions[] = [${clients.map((_, i) => `contribution${i}`).join(", ")}];`,
  ]);
  const initializerFile = "client/src/generated/component-initializers.ts";
  const initializers = components.flatMap(c => c.initializers);
  emit(initializerFile, [
    ...initializers.map((path, i) => `import { initialize as initialize${i} } from ${spec(initializerFile, path)};`),
    `export function initializeComponents(): void { ${initializers.map((_, i) => `initialize${i}();`).join(" ")} }`,
  ]);
  const migrationFile = "scripts/migrate/generated-components.ts";
  emit(migrationFile, components.flatMap(c => [...c.coreMigrations, ...c.migrations].map(path => `import ${spec(migrationFile, path)};`)).concat("export {};"));
  return components;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Discovered ${generateOptionalComponents().length} optional component(s)`);
}
