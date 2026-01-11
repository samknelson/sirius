import { storage } from "../storage";
import { checkAccess } from "../services/access-policy-evaluator";

export interface SupervisorOption {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}

export interface SupervisorContext {
  options: SupervisorOption[];
  assigneeOptions: SupervisorOption[];
  canManage: boolean;
  enforcedSupervisorId: string | null;
  currentUserInList: boolean;
}

export interface EdlsSettings {
  supervisor_role: string | null;
  employer: string | null;
}

export async function getEdlsSettings(): Promise<EdlsSettings> {
  const variable = await storage.variables.getByName("edls_settings");
  if (!variable?.value) {
    return { supervisor_role: null, employer: null };
  }
  try {
    const parsed = typeof variable.value === 'string' 
      ? JSON.parse(variable.value) 
      : variable.value;
    return { 
      supervisor_role: parsed.supervisor_role || null,
      employer: parsed.employer || null,
    };
  } catch {
    return { supervisor_role: null, employer: null };
  }
}

export async function getSupervisorOptions(supervisorRoleId: string | null): Promise<SupervisorOption[]> {
  if (!supervisorRoleId) {
    return [];
  }
  
  const usersWithRole = await storage.users.getUsersWithRole(supervisorRoleId);
  return usersWithRole.map(user => ({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
  }));
}

export async function getAssigneeOptions(): Promise<SupervisorOption[]> {
  const permissions = ['edls.coordinator', 'edls.manager', 'edls.supervisor', 'edls.worker.advisor'];
  const users = await storage.users.getUsersWithAnyPermission(permissions);
  
  return users.map(user => ({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
  }));
}

export async function getSupervisorContext(
  userId: string,
  sheetId?: string
): Promise<SupervisorContext> {
  const settings = await getEdlsSettings();
  const [options, assigneeOptions] = await Promise.all([
    getSupervisorOptions(settings.supervisor_role),
    getAssigneeOptions(),
  ]);
  
  const currentUserInList = options.some(opt => opt.id === userId);
  
  let canManage = false;
  if (sheetId) {
    const user = await storage.users.getUser(userId);
    if (user) {
      const result = await checkAccess('edls.sheet.manage', user, sheetId);
      canManage = result.granted;
    }
  } else {
    const isAdmin = await storage.users.userHasPermission(userId, 'admin');
    const isManager = await storage.users.userHasPermission(userId, 'edls.manager');
    const isCoordinator = await storage.users.userHasPermission(userId, 'edls.coordinator');
    const isWorkerAdvisor = await storage.users.userHasPermission(userId, 'edls.worker.advisor');
    const isSupervisor = await storage.users.userHasPermission(userId, 'edls.supervisor');
    canManage = isAdmin || isManager || isCoordinator || isWorkerAdvisor || isSupervisor;
  }
  
  const enforcedSupervisorId = !canManage && currentUserInList ? userId : null;
  
  return {
    options,
    assigneeOptions,
    canManage,
    enforcedSupervisorId,
    currentUserInList,
  };
}

export interface SupervisorValidationResult {
  valid: boolean;
  supervisorId: string | null;
  error?: string;
}

export function validateSupervisorForSave(
  context: SupervisorContext,
  submittedSupervisorId: string | null,
  currentUserId: string
): SupervisorValidationResult {
  if (context.canManage) {
    if (!submittedSupervisorId) {
      return { valid: false, supervisorId: null, error: "Supervisor is required" };
    }
    const validOption = context.options.find(opt => opt.id === submittedSupervisorId);
    if (!validOption) {
      return { valid: false, supervisorId: null, error: "Selected supervisor is not valid" };
    }
    return { valid: true, supervisorId: submittedSupervisorId };
  }
  
  if (context.currentUserInList) {
    return { valid: true, supervisorId: currentUserId };
  }
  
  return { 
    valid: false, 
    supervisorId: null, 
    error: "You do not have permission to save this sheet" 
  };
}
