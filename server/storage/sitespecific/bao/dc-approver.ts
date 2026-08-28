/**
 * Disability Credit approver capability.
 *
 * Preparation (documents, attestations, months, Send for Approval) is
 * ordinary staff work; FINAL decisions on queued cases — approve, deny, or
 * return to draft — are reserved for designated approvers. Administrators
 * designate approvers by granting this component permission to a role
 * (same mechanism as `bao.case.assign`); routes enforce it via
 * `storage.users.userHasPermission`.
 */
export const BAO_DC_APPROVE_PERMISSION = "bao.dc.approve";
