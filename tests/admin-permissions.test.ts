import { describe, expect, it } from "vitest";
import {
  getAssignedRoles,
  getAvailablePermissions,
  type Permission,
  type RolePermission,
} from "../client/src/components/admin/PermissionsManagement";

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

  it("reports the assigned role for metadata.view in the complete table", () => {
    expect(getAssignedRoles("metadata.view", [metadataAssignment])).toEqual([adminRole]);
  });
});