import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { personalExpression, personalField, transformPersonalDisplays } from "../../scripts/build/personal-displays";
import { maskModeHelp } from "../../server/help/system/mask-mode";
import { likePatternMatches } from "../../server/help/path-match";
import { sanitizeHtml } from "../../shared/utils/html";

describe("semantic JSX integration (same compiler in dev and production)", () => {
  it("keeps surrounding prose, branch-specific field rules and canonical filter predicates", () => {
    expect(personalExpression('`Email for ${worker.contactName}`', "example.tsx"))
      .toContain('`Email for ${mask(worker.contactName, "name")}`');
    expect(personalExpression('worker.email || worker.contactName', "example.tsx"))
      .toContain('mask(worker.email, "email") || mask(worker.contactName, "name")');
    expect(personalExpression('workers.filter(w => w.siriusId).map(w => w.contactName).join(", ")', "example.tsx"))
      .toContain('workers.filter(w => w.siriusId).map((w) => mask(w.contactName, "name"))');
    expect(personalExpression('dependents.map(d => `${d.name} (${d.genderCalc || "Gender not specified"})`).join(", ")', "example.tsx"))
      .toContain('${mask(d.name, "name")} (${d.genderCalc || "Gender not specified"})');
  });
  it("changes only personal text slots, presentation metadata and input hosts; matching/navigation/writes stay raw", () => {
    const source = `export const View = ({worker}:any) => <a href={"/workers/"+worker.id} onClick={() => save(worker)}>
      <span>{worker.contactName}</span><span>{worker.email}</span><span>{worker.hours}</span>
      <input id="ssn" value={worker.ssn} onChange={e => save(e.target.value)} />
      <span title={worker.contactName}>{worker.contactName}</span>
    </a>`;
    const result = transformPersonalDisplays(source, "/client/src/example.tsx").code;
    expect(result).toContain('mask(worker.contactName, "name")');
    expect(result).toContain('mask(worker.email, "email")');
    expect(result).toContain('personalFields={{"title": mask => (mask(worker.contactName, "name"))}}');
    expect(result).toContain('data-personal="ssn"');
    for (const raw of ['href={"/workers/"+worker.id}', 'onClick={() => save(worker)}',
      'value={worker.ssn}', 'onChange={e => save(e.target.value)}', "<span>{worker.hours}</span>"]) expect(result).toContain(raw);
  });
  it("uses identifiers, never user content or incidental English words", () => {
    for (const expression of ['"email"', '"family"', 'record.emailDetails.body', 'record.postalDetails.body',
      'record.emailDetails.subject', 'note.text', 'file.fileName', 'template.html', 'employer.name',
      'contact.contactType.name', 'steward.bargainingUnit.name', 'benefit.name', 'formatYmd(coverage.startDate)',
      'definition.displayName', 'wizardType?.displayName']) expect(personalField(expression, "/client/src/example.tsx")).toBeUndefined();
    expect(personalField("formatYmd(contact.birthDate)", "worker-view.tsx")).toBe("dob");
    expect(personalField("record.medium === 'email' ? record.emailDetails.subject : record.smsDetails.body", "CommList.tsx")).toBeUndefined();
  });
  it("covers representative production surfaces, including labels handed through shared hosts", () => {
    const surfaces: Record<string, string> = {
      "client/src/components/workers/workers-table.tsx": "worker.contactName",
      "client/src/pages/worker-view.tsx": "formatYmd(contact.birthDate)",
      "client/src/components/worker/NameManagement.tsx": 'contact?.displayName || "No name set"',
      "client/src/components/worker/IDsManagement.tsx": "id.value",
      "client/src/components/wizards/framework/enrollment/DependentsStep.tsx": "dep.name",
      "client/src/pages/workers/relations.tsx": "formOtherWorkerLabel",
      "client/src/pages/worker-benefits-eligibility.tsx": "subscriberName",
      "client/src/pages/employer-contact-view.tsx": "employerContact.contact.displayName",
      "client/src/pages/trust-provider-contact-view.tsx": "trustProviderContact.contact.displayName",
      "client/src/components/layout/QuickMasquerade.tsx": 'target.email || "No email"',
    };
    for (const [file, expression] of Object.entries(surfaces)) {
      const result = transformPersonalDisplays(readFileSync(file, "utf8"), file);
      expect(result.sites.some(site => site.expression === expression), `${file}: ${expression}`).toBe(true);
    }
    for (const file of ["client/src/components/worker/CommList.tsx", "client/src/components/comm/CommDetailContent.tsx"]) {
      const sites = transformPersonalDisplays(readFileSync(file, "utf8"), file).sites;
      expect(sites.filter(site => !site.expression.includes("<")).some(site => /\.(?:body|subject|notes)\b/.test(site.expression))).toBe(false);
    }
  });
  it("documents only intended help paths, with safe HTML and explicit limits", () => {
    for (const path of ["/mask-mode", "/config/components"]) expect(maskModeHelp.paths.some(pattern => likePatternMatches(pattern, path))).toBe(true);
    for (const path of ["/mask-mode-other", "/config/components/extra", "/workers", "/config/helps"]) expect(maskModeHelp.paths.some(pattern => likePatternMatches(pattern, path))).toBe(false);
    const html = sanitizeHtml(maskModeHelp.details!, "rich-document");
    for (const text of ["API responses", "clipboard", "Notes, documents/files", "keyboard", "HIPAA", "administrator", "Mask Mode ON"]) expect(html).toContain(text);
  });
});
