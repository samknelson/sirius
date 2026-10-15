import { describe, expect, it } from "vitest";
import {
  getAssignedRoles,
  getAvailablePermissions,
  getNextAllPermissionSelection,
  getNextPermissionSelection,
  type Permission,
  type RolePermission,
} from "../client/src/components/admin/PermissionsManagement";
import { findSystemHelpsForPath, getSystemHelp } from "../server/help/system";

const permissions: Permission[] = [
  {
    key: "metadata.view",
    description: "View record history metadata and provenance",
    module: "core",
  },
  {
    key: "staff",
    description: "Staff level access",
    module: "core",
  },
];

const adminRole = {
  id: "admin-role",
  name: "Administrators",
  description: null,
};

const metadataAssignment: RolePermission = {
  roleId: adminRole.id,
  permissionKey: "metadata.view",
  assignedAt: "2026-09-05T00:00:00.000Z",
  role: adminRole,
};

describe("permissions management catalog", () => {
  it("offers metadata.view to a role that does not already have it", () => {
    expect(getAvailablePermissions(permissions, [], adminRole.id)).toContainEqual(
      permissions[0],
    );
  });

  it("removes metadata.view from the assignment options after assignment", () => {
    expect(
      getAvailablePermissions(permissions, [metadataAssignment], adminRole.id),
    ).not.toContainEqual(permissions[0]);
  });

  it("filters assigned permissions only for the selected role", () => {
    const otherRole = { id: "other-role", name: "Other role", description: null };
    const otherAssignment: RolePermission = {
      roleId: otherRole.id,
      permissionKey: "staff",
      assignedAt: "2026-09-05T00:00:00.000Z",
      role: otherRole,
    };

    expect(getAvailablePermissions(permissions, [metadataAssignment, otherAssignment], adminRole.id))
      .toEqual([permissions[1]]);
    expect(getAvailablePermissions(permissions, [metadataAssignment, otherAssignment], otherRole.id))
      .toEqual([permissions[0]]);
  });

  it("adds and removes individual selection keys without duplicates", () => {
    expect(getNextPermissionSelection(["staff"], "metadata.view", true))
      .toEqual(["staff", "metadata.view"]);
    expect(getNextPermissionSelection(["staff", "metadata.view"], "staff", false))
      .toEqual(["metadata.view"]);
  });

  it("selects and clears all currently available permissions while preserving unrelated selections", () => {
    expect(getNextAllPermissionSelection(["older-choice"], permissions, true))
      .toEqual(["older-choice", "metadata.view", "staff"]);
    expect(getNextAllPermissionSelection(["older-choice", "metadata.view", "staff"], permissions, false))
      .toEqual(["older-choice"]);
  });

  it("reports the assigned role for metadata.view in the complete table", () => {
    expect(getAssignedRoles("metadata.view", [metadataAssignment])).toEqual([adminRole]);
  });
});

describe("built-in permissions management help", () => {
  it("uses a stable ID and matches only the permissions management page", () => {
    const help = getSystemHelp("system:admin-user-permissions");
    expect(help?.paths).toEqual(["/admin/users/permissions"]);
    expect(findSystemHelpsForPath("/admin/users/permissions")).toContainEqual(help);
    expect(findSystemHelpsForPath("/admin/users/permissions/roles")).not.toContainEqual(help);
    expect(findSystemHelpsForPath("/admin/users/roles")).not.toContainEqual(help);
  });

  it("renders sanitized guidance for role selection, multi-assignment, and results", () => {
    const details = getSystemHelp("system:admin-user-permissions")?.details ?? "";
    expect(details).toContain("<h3>How to use this page</h3>");
    expect(details).toContain("Select all available permissions");
    expect(details).toContain("add the checked permissions together");
    expect(details).toContain("Changing roles clears the pending checklist selection.");
  });
});