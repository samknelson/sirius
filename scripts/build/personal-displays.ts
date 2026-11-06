import ts from "typescript";
import type { PersonalField } from "../../shared/privacy/mask-mode";

/**
 * Semantic display inventory, shared by dev and production compilation.
 * Only JSX text slots are rewritten, never data, matching keys, props, URLs,
 * callbacks, form values or module exports. Ambiguous "name"/"value" fields
 * require a known person source or an explicit per-surface declaration.
 */
export function personalField(expression: string, file: string): PersonalField | undefined {
  const parsed = ts.createSourceFile("expression.tsx", `(${expression})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const keys = new Set<string>();
  const paths: string[] = [];
  const collect = (node: ts.Node) => {
    // A parent conditional must not classify itself from its nested JSX.
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return;
    if (ts.isIdentifier(node)) keys.add(node.text);
    if (ts.isPropertyAccessExpression(node)) paths.push(node.getText(parsed).replaceAll("?", ""));
    ts.forEachChild(node, collect);
  };
  collect(parsed);
  const has = (...names: string[]) => names.some(name => keys.has(name));
  if (paths.some(p => /\.emailDetails\.to$/.test(p))) return "email";
  if (paths.some(p => /\.smsDetails\.to$/.test(p))) return "phone";
  if (has("birthDate", "birth_date", "dateOfBirth", "dob")) return "dob";
  if (has("ssn", "formattedSSN", "editedSSN")) return "ssn";
  if (has("email", "userEmail", "contact_email", "emails", "currentEmail", "editedEmail")) return "email";
  if (has("phoneNumber", "phone_number", "primaryPhoneNumber", "formattedPhone", "formatPhoneNumberForDisplay", "phone", "mobile", "fax")) return "phone";
  if (has("street", "postalCode", "postal_code", "toCity", "toState", "toStreet", "toAddressLine1", "toAddressLine2", "fromAddressLine1", "fromAddressLine2", "canonicalAddress", "formatAddress")) return "address";
  if (has("firstName", "lastName", "middleName", "fullName", "contactName", "workerName", "subscriberName", "evaluatedSubscriberName", "evaluatedDependentName", "userFirstName", "userLastName", "given", "family", "generational", "toName",
    "editWorker1Label", "editWorker2Label", "currentWorkerLabel", "formOtherWorkerLabel", "selectedWorkerLabel", "selectedUserLabel", "selectedContactLabel", "selectedWorkerName", "authorName", "capturedByName", "coveredLabels", "cardholderName", "accountHolderName")) return "name";
  if (has("displayName") && !paths.some(p => /^(?:provider|definition|wizardType|selectedWizardType|reportType|type|report|bookmark)\.displayName$/.test(p))) return "name";
  if (has("getUserDisplayName", "getWorkerName", "getContactName", "formatWorkerName", "workerLabel", "userLabel", "formatUserName", "getUserName", "getInitials")) return "name";
  if (file.endsWith("/StaffRecipientsField.tsx") && has("labelById")) return "name";
  if (file.endsWith("/target-dashboard-view.tsx") && has("name")) return "name";
  if (file.endsWith("/stewards.tsx") && has("selectedNames")) return "name";
  // "name" alone is NOT personal: employers, benefits, statuses, etc. retain it.
  if (paths.some(p => /(?:^|\.)(?:worker|user|contact|dep|d|dependent|beneficiary|person|representative|steward|foreman|assignee|target|originalUser|selectedWorker|selectedUser|selectedContact)\.name$/i.test(p))) return "name";
  if (paths.some(p => /(?:^|\.)(?:worker|contact|dependent|beneficiary)\.(?:siriusId|identifier)$/.test(p))) return "identifier";
  if (/\/(?:IDsManagement|workers-table)\.tsx$/.test(file) && has("value", "formattedValue")) return "identifier";
  if (/\/(?:AddressManagement|unified-address-input|conditional-address-form|worker-view|workers-table)\.tsx$/.test(file) &&
      has("city", "state", "country")) return "address";
  return undefined;
}

export interface PersonalDisplaySite { expression: string; kind: PersonalField; line: number }

/**
 * Mask semantic values, not the surrounding prose or conditional selectors.
 * For example `Email for ${worker.contactName}` keeps "Email for"; a name/
 * email fallback uses the formatter for the branch actually being displayed.
 */
export function personalExpression(expression: string, file: string): string {
  const source = ts.createSourceFile("expression.tsx", `(${expression})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const render = (node: ts.Node): string => {
    const original = node.getText(source);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return original;
    if (ts.isParenthesizedExpression(node)) return `(${render(node.expression)})`;
    if (ts.isConditionalExpression(node)) return `${node.condition.getText(source)} ? ${render(node.whenTrue)} : ${render(node.whenFalse)}`;
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.PlusToken].includes(node.operatorToken.kind)) {
      return `${render(node.left)} ${node.operatorToken.getText(source)} ${render(node.right)}`;
    }
    if (ts.isTemplateExpression(node)) {
      let value = node.head.getText(source);
      for (const span of node.templateSpans) value += render(span.expression) + span.literal.getText(source);
      return value;
    }
    if (ts.isArrayLiteralExpression(node)) return `[${node.elements.map(render).join(", ")}]`;
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
      return `(${node.parameters.map(p => p.getText(source)).join(", ")}) => ${render(node.body)}`;
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "filter") return original;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "join" &&
        ts.isCallExpression(node.expression.expression) && ts.isPropertyAccessExpression(node.expression.expression.expression) &&
        node.expression.expression.expression.name.text === "filter") {
      const kind = personalField(original, file);
      return kind ? `mask(${original}, "${kind}")` : original;
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["map", "join"].includes(node.expression.name.text)) {
      return `${render(node.expression.expression)}.${node.expression.name.text}(${node.arguments.map(render).join(", ")})`;
    }
    const kind = personalField(original, file);
    return kind ? `mask(${original}, "${kind}")` : original;
  };
  const statement = source.statements[0];
  return ts.isExpressionStatement(statement) ? render(statement.expression) : expression;
}

export function transformPersonalDisplays(code: string, file: string) {
  if (!file.endsWith(".tsx") || file.includes("/client/src/privacy/") || file.endsWith("/ui/input.tsx")) return { code, sites: [] as PersonalDisplaySite[] };
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits: { position: number; text: string }[] = [];
  const replacements: { position: number; end: number; text: string }[] = [];
  const sites: PersonalDisplaySite[] = [];
  const fieldKind = (key: string): PersonalField | undefined => {
    if (/ssn/i.test(key)) return "ssn";
    if (/birth.?date|date.?of.?birth|\bdob\b/i.test(key)) return "dob";
    if (/email/i.test(key)) return "email";
    if (/phone|mobile|fax/i.test(key)) return "phone";
    if (/given|family|first.?name|last.?name|middle|generational|beneficiar.*\.name|dependent.*\.name/i.test(key)) return "name";
    if (/street|postal.?code|city|state|country/i.test(key)) return "address";
    if (/\/(?:NameManagement|EntityNameManagement|edit-worker-name-modal|ContactsStep|employer-contact-edit|trust-provider-contact-edit|csg-edit|csg-new)\.tsx$/.test(file) && /^(?:name|title|credentials)$/.test(key)) return "name";
    if (/\/IDsManagement\.tsx$/.test(file) && /value/i.test(key)) return "identifier";
    return undefined;
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const fields: string[] = [];
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || !["title", "aria-label", "alt", "placeholder"].includes(attr.name.getText(source))) continue;
        if (attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
          const expression = attr.initializer.expression.getText(source);
          const kind = expression.includes("personal(") ? undefined : personalField(expression, file);
          if (kind) fields.push(`${JSON.stringify(attr.name.getText(source))}: mask => ${personalExpression(expression, file)}`);
        }
      }
      if (fields.length) {
        const tag = node.tagName.getText(source);
        const as = tag === "input" ? "SiriusPersonalInput" : /^[a-z]/.test(tag) ? JSON.stringify(tag) : tag;
        replacements.push({ position: node.tagName.getStart(source), end: node.tagName.end, text: "SiriusPersonalSurface" });
        edits.push({ position: node.attributes.pos, text: ` as={${as}} personalFields={{${fields.join(", ")}}} ` });
        if (ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent)) {
          const closing = node.parent.closingElement.tagName;
          replacements.push({ position: closing.getStart(source), end: closing.end, text: "SiriusPersonalSurface" });
        }
      }
    }
    // Native inputs need the same canonical/presentation separation as the
    // shared Input. Password/file/hidden controls are left alone by the host.
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node) || ts.isJsxClosingElement(node)) &&
        node.tagName.getText(source) === "input" && !replacements.some(r => r.position === node.tagName.getStart(source))) {
      replacements.push({ position: node.tagName.getStart(source), end: node.tagName.end, text: "SiriusPersonalInput" });
    }
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && ["input", "Input", "CommandInput"].includes(node.tagName.getText(source))) {
      let kind: PersonalField | undefined;
      let annotated = false;
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr)) continue;
        if (attr.name.getText(source) === "data-personal") annotated = true;
        if (attr.initializer && ts.isStringLiteral(attr.initializer) && ["name", "id", "data-testid"].includes(attr.name.getText(source))) kind ??= fieldKind(attr.initializer.text);
        if (attr.name.getText(source) === "value" && attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
          kind ??= personalField(attr.initializer.expression.getText(source), file);
        }
      }
      for (let parent: ts.Node | undefined = node.parent; parent && !kind; parent = parent.parent) {
        if ((ts.isJsxSelfClosingElement(parent) || ts.isJsxOpeningElement(parent)) && parent.tagName.getText(source) === "FormField") {
          for (const attr of parent.attributes.properties) {
            if (ts.isJsxAttribute(attr) && attr.name.getText(source) === "name" && attr.initializer) {
              kind = fieldKind(attr.initializer.getText(source).replace(/["'`]/g, ""));
            }
          }
          break;
        }
      }
      if (kind && !annotated) edits.push({ position: node.attributes.pos, text: ` data-personal="${kind}" ` });
    }
    if (ts.isJsxExpression(node) && node.expression &&
        (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const expression = node.expression.getText(source);
      // An explicit PersonalText is already a semantic boundary.
      const explicit = ts.isJsxElement(node.parent) && /PersonalText$/.test(node.parent.openingElement.tagName.getText(source));
      let nestedJsx = false;
      const findJsx = (child: ts.Node) => {
        if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) { nestedJsx = true; return; }
        ts.forEachChild(child, findJsx);
      };
      findJsx(node.expression);
      // Descendant slots/attributes are handled individually. Never replace an
      // enclosing JSX conditional and discard its children's transformations.
      const kind = explicit || nestedJsx ? undefined : personalField(expression, file);
      if (kind) {
        sites.push({ expression, kind, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
        replacements.push({ position: node.getStart(source), end: node.end,
          text: `<SiriusPersonalValue render={mask => ${personalExpression(expression, file)}} />` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!edits.length && !replacements.length) return { code, sites };
  const allEdits = [...edits.map(e => ({ ...e, end: e.position })), ...replacements].sort((a, b) => b.position - a.position);
  for (const edit of allEdits) code = code.slice(0, edit.position) + edit.text + code.slice(edit.end);
  return { code: `import { PersonalValue as SiriusPersonalValue } from "@/privacy/MaskMode";\nimport { PersonalInput as SiriusPersonalInput } from "@/privacy/PersonalInput";\nimport { PersonalSurface as SiriusPersonalSurface } from "@/privacy/PersonalSurface";\n${code}`, sites };
}

export function personalDisplaysPlugin() {
  return {
    name: "sirius-semantic-personal-displays",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (!id.includes("/client/src/")) return null;
      const result = transformPersonalDisplays(code, id.split("?")[0]);
      return result.code !== code ? { code: result.code, map: null } : null;
    },
  };
}
