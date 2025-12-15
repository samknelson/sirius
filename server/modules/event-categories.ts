export interface EventCategoryRole {
  id: string;
  label: string;
  canManageParticipants?: boolean;
}

export interface EventCategoryStatus {
  id: string;
  label: string;
}

export interface EventCategoryConfigOption {
  key: string;
  label: string;
  type: "number" | "boolean" | "string" | "select";
  options?: { value: string; label: string }[];
  defaultValue?: any;
  description?: string;
  scope: "type" | "event" | "both";
}

export interface EventCategoryDefinition {
  id: string;
  label: string;
  description?: string;
  roles: EventCategoryRole[];
  statuses: EventCategoryStatus[];
  configOptions: EventCategoryConfigOption[];
}

const eventCategories: Record<string, EventCategoryDefinition> = {
  class: {
    id: "class",
    label: "Class",
    description: "Educational classes with instructors and students",
    roles: [
      { id: "instructor", label: "Instructor", canManageParticipants: true },
      { id: "student", label: "Student" },
    ],
    statuses: [
      { id: "registered", label: "Registered" },
      { id: "attended", label: "Attended" },
      { id: "completed", label: "Completed" },
      { id: "dropout", label: "Dropout" },
      { id: "no_show", label: "No Show" },
    ],
    configOptions: [
      {
        key: "maxStudents",
        label: "Maximum Students",
        type: "number",
        description: "Maximum number of students allowed",
        scope: "both",
      },
      {
        key: "requiresPrerequisites",
        label: "Requires Prerequisites",
        type: "boolean",
        defaultValue: false,
        scope: "type",
      },
    ],
  },
  public: {
    id: "public",
    label: "Public Event",
    description: "Public events with organizers only (no participant tracking)",
    roles: [
      { id: "organizer", label: "Organizer", canManageParticipants: true },
    ],
    statuses: [],
    configOptions: [
      {
        key: "isOpen",
        label: "Open to Public",
        type: "boolean",
        defaultValue: true,
        scope: "event",
      },
    ],
  },
  membership: {
    id: "membership",
    label: "Membership Event",
    description: "Events where members can register their attendance",
    roles: [
      { id: "organizer", label: "Organizer", canManageParticipants: true },
      { id: "member", label: "Member" },
    ],
    statuses: [
      { id: "registered", label: "Registered" },
      { id: "attended", label: "Attended" },
      { id: "absent", label: "Absent" },
    ],
    configOptions: [
      {
        key: "maxAttendees",
        label: "Maximum Attendees",
        type: "number",
        description: "Maximum number of attendees allowed",
        scope: "both",
      },
      {
        key: "requiresRSVP",
        label: "Requires RSVP",
        type: "boolean",
        defaultValue: false,
        scope: "type",
      },
    ],
  },
};

export function getEventCategory(categoryId: string): EventCategoryDefinition | undefined {
  return eventCategories[categoryId];
}

export function getAllEventCategories(): EventCategoryDefinition[] {
  return Object.values(eventCategories);
}

export function getCategoryRoles(categoryId: string): EventCategoryRole[] {
  return eventCategories[categoryId]?.roles ?? [];
}

export function getCategoryStatuses(categoryId: string): EventCategoryStatus[] {
  return eventCategories[categoryId]?.statuses ?? [];
}

export function getCategoryConfigOptions(categoryId: string, scope?: "type" | "event"): EventCategoryConfigOption[] {
  const category = eventCategories[categoryId];
  if (!category) return [];
  
  if (!scope) return category.configOptions;
  
  return category.configOptions.filter(
    opt => opt.scope === scope || opt.scope === "both"
  );
}

export function validateParticipantRole(categoryId: string, role: string): boolean {
  const category = eventCategories[categoryId];
  if (!category) return false;
  return category.roles.some(r => r.id === role);
}

export function validateParticipantStatus(categoryId: string, status: string): boolean {
  const category = eventCategories[categoryId];
  if (!category) return false;
  if (category.statuses.length === 0) return true;
  return category.statuses.some(s => s.id === status);
}
