import { registerMenuPlugin } from "../registry";
import type { MenuItemDef } from "../types";

/**
 * The `default` menu plugin: a declarative port of the header navigation
 * that used to be hardcoded in `client/src/components/layout/Header.tsx`.
 * Every item carries the same permission / policy / component gating the
 * old JSX enforced inline; the resolver evaluates the gates per user.
 *
 * Exported so other menu plugins (e.g. `edls`) can reuse pieces of this
 * tree by calling the builder and reshaping the result.
 */
export function buildDefaultMenuTree(): MenuItemDef[] {
  return [
    {
      id: "home",
      label: "Home",
      icon: "Home",
      href: "/",
      testId: "nav-home",
    },
    {
      id: "my-worker",
      label: "My Worker",
      icon: "User",
      href: "/workers/:workerId",
      testId: "nav-my-worker",
      gate: { allOf: [{ permission: "worker" }, { workerLinked: true }] },
    },
    {
      id: "my-qr-code",
      label: "My QR Code",
      icon: "QrCode",
      href: "/my-qr-code",
      testId: "nav-my-qr-code",
      gate: { workerLinked: true },
    },
    {
      id: "my-employers",
      label: "My Employer",
      icon: "Building2",
      testId: "nav-my-employer",
      special: "myEmployers",
    },
    {
      id: "employer-dispatch",
      label: "Dispatch Jobs",
      icon: "Briefcase",
      href: "/dispatch/jobs",
      active: { type: "prefix", value: "/dispatch" },
      testId: "nav-employer-dispatch",
      gate: {
        allOf: [
          { permission: "employer.dispatch" },
          { component: "dispatch" },
          { not: { policy: "staff" } },
        ],
      },
    },
    {
      id: "my-dispatches",
      label: "My Dispatches",
      icon: "Briefcase",
      href: "/workers/:workerId/dispatch/list",
      active: { type: "includes", value: "/dispatch" },
      testId: "nav-my-dispatches",
      gate: {
        allOf: [
          { permission: "worker" },
          { component: "dispatch" },
          { workerLinked: true },
          { not: { policy: "staff" } },
        ],
      },
    },
    {
      id: "workers",
      label: "Workers",
      icon: "Users",
      testId: "nav-workers",
      gate: {
        anyOf: [{ policy: "worker.list" }, { policy: "bulk.edit" }, { policy: "staff" }],
      },
      children: [
        {
          id: "workers-list",
          label: "List",
          icon: "List",
          href: "/workers",
          testId: "menu-workers-list",
        },
        {
          id: "cardcheck-definitions",
          label: "Cardchecks",
          icon: "ClipboardCheck",
          href: "/cardcheck-definitions",
          active: { type: "prefix", value: "/cardcheck" },
          testId: "menu-cardcheck-definitions",
          gate: { allOf: [{ policy: "staff" }, { component: "cardcheck" }] },
        },
        {
          id: "bargaining-units",
          label: "Bargaining Units",
          icon: "Users",
          href: "/bargaining-units",
          active: { type: "prefix", value: "/bargaining-units" },
          testId: "menu-bargaining-units",
          gate: { allOf: [{ policy: "staff" }, { component: "bargainingunits" }] },
        },
        {
          id: "stewards",
          labelTerm: { key: "steward", plural: true },
          icon: "Shield",
          href: "/stewards",
          testId: "menu-stewards",
          gate: { allOf: [{ policy: "staff" }, { component: "worker.steward" }] },
        },
        {
          id: "class-size-grievances",
          label: "Class Size Grievances",
          icon: "FileWarning",
          href: "/sitespecific/btu/csgs",
          active: { type: "prefix", value: "/sitespecific/btu/csg" },
          testId: "menu-class-size-grievances",
          gate: { allOf: [{ policy: "staff" }, { component: "sitespecific.btu" }] },
        },
        {
          id: "btu-worker-import",
          label: "Worker Import",
          icon: "Upload",
          href: "/sitespecific/btu/worker-import",
          active: { type: "prefix", value: "/sitespecific/btu/worker-import" },
          testId: "menu-btu-worker-import",
          gate: {
            anyOf: [
              { allOf: [{ policy: "staff" }, { component: "sitespecific.hta" }] },
              { allOf: [{ component: "sitespecific.btu" }, { permission: "admin" }] },
            ],
          },
        },
        {
          id: "btu-dues-allocation",
          label: "Dues Allocation",
          icon: "Droplets",
          href: "/sitespecific/btu/dues-allocation",
          active: { type: "prefix", value: "/sitespecific/btu/dues-allocation" },
          testId: "menu-btu-dues-allocation",
          gate: {
            anyOf: [
              { allOf: [{ policy: "staff" }, { component: "sitespecific.hta" }] },
              { allOf: [{ component: "sitespecific.btu" }, { permission: "admin" }] },
            ],
          },
        },
        {
          id: "btu-cardcheck-import",
          label: "Card Check Import",
          icon: "FileCheck",
          href: "/sitespecific/btu/cardcheck-import",
          active: { type: "prefix", value: "/sitespecific/btu/cardcheck-import" },
          testId: "menu-btu-cardcheck-import",
          gate: { allOf: [{ component: "sitespecific.btu" }, { permission: "admin" }] },
        },
        {
          id: "btu-sig-import",
          label: "Signature Import",
          icon: "FileCheck",
          href: "/sitespecific/btu/cardcheck-sig-import",
          active: { type: "prefix", value: "/sitespecific/btu/cardcheck-sig-import" },
          testId: "menu-btu-sig-import",
          gate: { allOf: [{ component: "sitespecific.btu" }, { permission: "admin" }] },
        },
        {
          id: "btu-scrape-import",
          label: "Scraper Import",
          icon: "FileCheck",
          href: "/sitespecific/btu/cardcheck-scrape-import",
          active: { type: "prefix", value: "/sitespecific/btu/cardcheck-scrape-import" },
          testId: "menu-btu-scrape-import",
          gate: { allOf: [{ component: "sitespecific.btu" }, { permission: "admin" }] },
        },
        {
          id: "btu-building-rep-import",
          label: "Building Rep Import",
          icon: "Users",
          href: "/sitespecific/btu/building-rep-import",
          active: { type: "prefix", value: "/sitespecific/btu/building-rep-import" },
          testId: "menu-btu-building-rep-import",
          gate: { allOf: [{ component: "sitespecific.btu" }, { permission: "admin" }] },
        },
      ],
    },
    {
      id: "employers",
      label: "Employers",
      icon: "Building2",
      testId: "nav-employers",
      gate: { policy: "staff" },
      children: [
        {
          id: "employers-list-btu",
          label: "Organizing Employer List",
          icon: "Building2",
          href: "/employers/organizing",
          active: { type: "prefix", value: "/employers" },
          testId: "menu-employers-list",
          gate: { component: "sitespecific.btu" },
        },
        {
          id: "employers-list",
          label: "Employers",
          icon: "Building2",
          href: "/employers",
          active: { type: "prefix", value: "/employers" },
          testId: "menu-employers-list",
          gate: { not: { component: "sitespecific.btu" } },
        },
        {
          id: "companies",
          label: "Companies",
          icon: "Building2",
          href: "/companies",
          active: { type: "prefix", value: "/companies" },
          testId: "menu-companies",
          gate: { component: "employer.company" },
        },
        {
          id: "employer-contacts",
          label: "Employer Contacts",
          icon: "Users",
          href: "/employer-contacts/all",
          active: { type: "prefix", value: "/employer-contacts" },
          testId: "menu-employer-contacts-all",
        },
        {
          id: "monthly-uploads",
          label: "Monthly Uploads",
          icon: "Calendar",
          href: "/employers/monthly-uploads",
          testId: "menu-monthly-uploads",
        },
        {
          id: "employer-map",
          label: "Employer Map",
          icon: "Map",
          href: "/sitespecific/btu/employer-map",
          testId: "menu-employer-map",
          gate: { component: "sitespecific.btu" },
        },
        {
          id: "dispatch-jobs",
          label: "Dispatch Jobs",
          icon: "Briefcase",
          href: "/dispatch/jobs",
          active: { type: "prefix", value: "/dispatch/jobs" },
          testId: "menu-dispatch-jobs",
          gate: { component: "dispatch" },
        },
        {
          id: "dispatch-job-groups",
          label: "Job Groups",
          icon: "Layers",
          href: "/dispatch/job_groups",
          active: { type: "prefix", value: "/dispatch/job_group" },
          testId: "menu-dispatch-job-groups",
          gate: { component: "dispatch.job_group" },
        },
        {
          id: "facilities",
          label: "Facilities",
          icon: "Building2",
          href: "/facilities",
          active: { type: "prefix", value: "/facilities" },
          testId: "menu-facilities",
          gate: { component: "facility" },
        },
        {
          id: "employers-organizing",
          label: "Organizing",
          icon: "ClipboardCheck",
          href: "/employers/organizing",
          testId: "menu-employers-organizing",
          gate: {
            allOf: [
              { component: "cardcheck" },
              { permission: "staff" },
              { not: { component: "sitespecific.btu" } },
            ],
          },
        },
      ],
    },
    {
      id: "edls",
      label: "EDLS",
      icon: "FileSpreadsheet",
      active: { type: "prefix", value: "/edls" },
      testId: "nav-edls",
      gate: {
        allOf: [
          { component: "edls" },
          { anyOf: [{ policy: "staff" }, { policy: "edls.any" }] },
        ],
      },
      children: buildEdlsMenuItems(),
    },
    {
      id: "trust",
      label: "Trust",
      icon: "Shield",
      testId: "nav-trust",
      gate: {
        anyOf: [
          { allOf: [{ component: "trust.providers" }, { permission: "staff" }] },
          { allOf: [{ permission: "admin" }, { component: "trust.benefits.scan" }] },
        ],
      },
      children: [
        {
          id: "trust-providers",
          label: "Providers",
          icon: "Shield",
          href: "/trust/providers",
          active: { type: "prefix", value: "/trust/provider" },
          testId: "menu-trust-providers",
          gate: { allOf: [{ component: "trust.providers" }, { permission: "staff" }] },
        },
        {
          id: "benefit-scan",
          label: "Benefit Scan",
          icon: "ScanLine",
          href: "/admin/wmb-scan-queue",
          testId: "menu-benefit-scan",
          gate: { allOf: [{ permission: "admin" }, { component: "trust.benefits.scan" }] },
        },
      ],
    },
    {
      id: "events",
      label: "Events",
      icon: "Calendar",
      href: "/events",
      active: { type: "prefix", value: "/events" },
      testId: "nav-events",
      gate: { allOf: [{ component: "event" }, { permission: "admin" }] },
    },
    {
      id: "bulk-messages",
      label: "Bulk Messages",
      icon: "Megaphone",
      href: "/bulk/list",
      active: { type: "prefix", value: "/bulk" },
      testId: "nav-bulk-messages",
      gate: { policy: "bulk.edit" },
    },
    {
      id: "ledger-accounts",
      label: "Accounts",
      icon: "BookOpen",
      href: "/ledger/accounts",
      active: { type: "prefix", value: "/ledger/accounts" },
      testId: "nav-ledger-accounts",
      gate: { policy: "staff" },
    },
    {
      id: "grievances",
      label: "Grievances",
      icon: "FileText",
      href: "/grievances",
      active: { type: "prefix", value: "/grievance" },
      testId: "nav-grievances-top",
      gate: { allOf: [{ component: "grievance" }, { policy: "staff" }] },
    },
    buildUsersMenuItem(),
    {
      id: "reports",
      label: "Reports",
      icon: "FileText",
      active: { type: "prefix", value: "/reports" },
      testId: "nav-reports",
      gate: { anyOf: [{ permission: "admin" }, { permission: "staff" }] },
      children: [
        {
          id: "reports-all",
          label: "All Reports",
          icon: "FileText",
          href: "/reports",
          testId: "menu-reports-all",
          gate: { permission: "admin" },
        },
        {
          id: "cardcheck-report",
          label: "Card Check Report",
          icon: "FileCheck",
          href: "/reports/cardchecks",
          testId: "menu-cardcheck-report",
          gate: { allOf: [{ component: "cardcheck" }, { permission: "staff" }] },
        },
        {
          id: "employer-compliance",
          label: "Employer Compliance",
          icon: "FileCheck",
          href: "/employers/compliance",
          testId: "menu-employer-compliance",
          gate: { allOf: [{ permission: "staff" }, { component: "ledger" }] },
        },
        {
          id: "contact-export",
          label: "Contact Export",
          icon: "FileSpreadsheet",
          href: "/reports/contact-export",
          testId: "menu-contact-export",
          gate: { permission: "staff" },
        },
        {
          id: "political-profiles",
          label: "Political Profiles",
          icon: "Landmark",
          href: "/reports/political-profiles",
          testId: "menu-political-profiles",
          gate: { allOf: [{ permission: "staff" }, { component: "sitespecific.btu.political" }] },
        },
      ],
    },
    buildConfigMenuItem(),
  ];
}

/**
 * The three EDLS links with their per-item gates. Shared between the
 * `default` plugin (as a dropdown) and the `edls` plugin (as top-level
 * items). Gates are self-contained so promotion to top level keeps the
 * exact same access behavior.
 */
export function buildEdlsMenuItems(): MenuItemDef[] {
  return [
    {
      id: "edls-sheets",
      label: "Sheets",
      icon: "FileSpreadsheet",
      href: "/edls/sheets",
      testId: "menu-edls-sheets",
      gate: { anyOf: [{ policy: "staff" }, { policy: "edls.reader" }] },
    },
    {
      id: "edls-tos",
      label: "Absences",
      icon: "Stethoscope",
      href: "/edls/tos",
      testId: "menu-edls-tos",
      gate: { allOf: [{ component: "worker.tos" }, { policy: "edls.any" }] },
    },
    {
      id: "edls-freeman-crewleads",
      label: "Crew Leads",
      icon: "UserCog",
      href: "/edls/freeman/crewleads",
      testId: "menu-edls-freeman-crewleads",
      gate: { allOf: [{ component: "sitespecific.freeman" }, { policy: "edls.any" }] },
    },
  ];
}

/** The admin Users dropdown, reused by the `edls` plugin. */
export function buildUsersMenuItem(): MenuItemDef {
  return {
    id: "users",
    label: "Users",
    icon: "UserCog",
    active: { type: "prefix", value: "/admin/users" },
    testId: "nav-users",
    gate: { permission: "admin" },
    children: [
      {
        id: "users-list",
        label: "Users",
        icon: "Users",
        href: "/admin/users/list",
        testId: "menu-users-list",
      },
      {
        id: "users-roles",
        label: "Roles",
        icon: "Shield",
        href: "/admin/users/roles",
        testId: "menu-users-roles",
      },
      {
        id: "users-permissions",
        label: "Permissions",
        icon: "Key",
        href: "/admin/users/permissions",
        testId: "menu-users-permissions",
      },
      {
        id: "users-policies",
        label: "Policies",
        icon: "FileText",
        href: "/admin/users/policies",
        testId: "menu-users-policies",
      },
      {
        id: "users-masquerade",
        label: "Masquerade",
        icon: "UserCog",
        href: "/admin/users/masquerade",
        separatorBefore: true,
        testId: "menu-users-masquerade",
      },
      {
        id: "users-sessions",
        label: "Sessions",
        icon: "Clock",
        href: "/config/users/sessions",
        testId: "menu-users-sessions",
      },
      {
        id: "users-flood-events",
        label: "Flood Events",
        icon: "Droplets",
        href: "/admin/users/flood-events",
        testId: "menu-users-flood-events",
      },
    ],
  };
}

/** The Configuration link, reused by the `edls` plugin. */
export function buildConfigMenuItem(): MenuItemDef {
  return {
    id: "config",
    label: "Configuration",
    icon: "Settings",
    href: "/config",
    active: { type: "prefix", value: "/config" },
    testId: "nav-config",
    gate: { permission: "admin" },
  };
}

registerMenuPlugin({
  metadata: {
    id: "default",
    name: "Default",
    description:
      "The standard Sirius main navigation: Workers, Employers, EDLS, Trust, Reports, Users, and Configuration.",
  },
  buildTree: buildDefaultMenuTree,
});
