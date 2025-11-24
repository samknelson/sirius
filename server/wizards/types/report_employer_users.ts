import { WizardReport, ReportConfig, ReportColumn, ReportRecord } from '../report.js';

export class ReportEmployerUsers extends WizardReport {
  name = 'report_employer_users';
  displayName = 'Employer Users';
  description = 'Lists all users associated with employer contacts, showing employer, user details, roles, and activity status';
  category = 'Employers';

  getPrimaryKeyField(): string {
    return 'employerContactId';
  }

  getColumns(): ReportColumn[] {
    return [
      {
        id: 'employerName',
        header: 'Employer',
        type: 'string',
        width: 250
      },
      {
        id: 'userName',
        header: 'User Name',
        type: 'string',
        width: 200
      },
      {
        id: 'userEmail',
        header: 'User Email',
        type: 'string',
        width: 250
      },
      {
        id: 'roles',
        header: 'Roles',
        type: 'string',
        width: 250
      },
      {
        id: 'isActive',
        header: 'Active',
        type: 'boolean',
        width: 100
      },
      {
        id: 'lastLogin',
        header: 'Last Login',
        type: 'date',
        width: 180
      },
      {
        id: 'viewLink',
        header: 'View',
        type: 'string',
        width: 80
      }
    ];
  }

  async fetchRecords(
    config: ReportConfig,
    batchSize: number = 100,
    onProgress?: (progress: { processed: number; total: number }) => void
  ): Promise<ReportRecord[]> {
    const { db } = await import('../../db.js');
    const { users, contacts, employerContacts, employers, userRoles, roles } = await import('@shared/schema');
    const { eq, sql } = await import('drizzle-orm');

    // Query to get all users associated with employer contacts
    // Note: Users are linked to contacts via email matching (not a foreign key)
    // because the users table doesn't have a contactId field. This is the
    // established pattern in the codebase for linking users to contacts.
    // Join chain: users -> contacts (via email) -> employerContacts -> employers
    // Also get roles via userRoles join
    const results = await db
      .select({
        employerContactId: employerContacts.id,
        employerId: employers.id,
        employerName: employers.name,
        userId: users.id,
        userName: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`.as('userName'),
        userEmail: users.email,
        isActive: users.isActive,
        lastLogin: users.lastLogin,
        roleNames: sql<string>`STRING_AGG(${roles.name}, ', ' ORDER BY ${roles.name})`.as('roleNames'),
      })
      .from(users)
      .innerJoin(contacts, eq(users.email, contacts.email))
      .innerJoin(employerContacts, eq(contacts.id, employerContacts.contactId))
      .innerJoin(employers, eq(employerContacts.employerId, employers.id))
      .leftJoin(userRoles, eq(users.id, userRoles.userId))
      .leftJoin(roles, eq(userRoles.roleId, roles.id))
      .groupBy(
        employerContacts.id,
        employers.id,
        employers.name,
        users.id,
        users.firstName,
        users.lastName,
        users.email,
        users.isActive,
        users.lastLogin
      );

    const records: ReportRecord[] = results.map(result => ({
      employerContactId: result.employerContactId,
      viewLink: result.employerContactId,
      employerId: result.employerId,
      employerName: result.employerName || '',
      userId: result.userId,
      userName: result.userName || '',
      userEmail: result.userEmail || '',
      roles: result.roleNames || 'None',
      isActive: result.isActive ?? false,
      lastLogin: result.lastLogin || null
    }));

    // Report progress
    if (onProgress) {
      onProgress({
        processed: records.length,
        total: records.length
      });
    }

    return records;
  }
}
