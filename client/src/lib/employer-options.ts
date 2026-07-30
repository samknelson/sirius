/**
 * Shared helpers for employer dropdown options.
 *
 * When the employer.company component is enabled, employer list endpoints
 * include a `companyName` for employers linked to a company. Dropdowns
 * display "Company Name – Employer Name" and sort by company name first,
 * then employer name; employers without a company sort after those with
 * one, alphabetical by employer name. When the component is off (or no
 * company is linked), labels and sorting fall back to the employer name.
 */

export interface EmployerOptionLike {
  id: string;
  name: string;
  companyName?: string | null;
}

export function formatEmployerLabel(e: EmployerOptionLike): string {
  return e.companyName ? `${e.companyName} – ${e.name}` : e.name;
}

export function sortEmployerOptions<T extends EmployerOptionLike>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ac = a.companyName || null;
    const bc = b.companyName || null;
    if (ac && bc) {
      const cmp = ac.localeCompare(bc);
      if (cmp !== 0) return cmp;
      return a.name.localeCompare(b.name);
    }
    if (ac) return -1;
    if (bc) return 1;
    return a.name.localeCompare(b.name);
  });
}
