import type { SystemHelpEntry } from "./index";

export const adminUserPermissionsHelp: SystemHelpEntry = {
  id: "system:admin-user-permissions",
  paths: ["/admin/users/permissions"],
  summary: "Assign one or more system permissions to a role and review or remove existing assignments.",
  details: `
    <h3>Purpose</h3>
    <p>Use Permissions Management to grant system permissions to an existing role.</p>
    <h3>Before you start</h3>
    <p>You need administrator access. Permission definitions come from the system and cannot be created or changed here.</p>
    <h3>How to use this page</h3>
    <ol>
      <li>Choose a role from <strong>Select Role</strong>.</li>
      <li>Check one or more permissions that are not already assigned to that role. Use <strong>Select all available permissions</strong> to check every permission currently offered for the selected role.</li>
      <li>Select <strong>Assign</strong> to add the checked permissions together. The button shows the number selected and indicates when the request is in progress.</li>
    </ol>
    <h3>Results and status meanings</h3>
    <p>After a successful assignment, the page refreshes the role-permission overview and shows how many permissions were assigned. Permissions already assigned to the selected role are omitted from the checklist. The overview lists each permission and its assigned roles; use the remove button beside a role to unassign one permission.</p>
    <h3>Limitations and common problems</h3>
    <p>Changing roles clears the pending checklist selection. If an assignment fails, an error message appears and your selection remains available so you can review it or try again.</p>
  `,
};
