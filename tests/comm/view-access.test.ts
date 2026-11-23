import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express, NextFunction, Request, Response } from 'express';
import type { User } from '@shared/schema';
import policy, { setLinkedCommViewResolver } from '@shared/access-policies/comm/view';
import '@shared/access-policies/edls/sheet/view';
import {
  clearAccessCache, evaluatePolicy, initAccessControl, requireAccess,
} from '../../server/services/access-policy-evaluator';
import { wireCommViewAccess } from '../../server/services/comm/view-access';

const mocks = vi.hoisted(() => ({
  record: vi.fn(), logs: vi.fn(), errors: vi.fn(),
}));
vi.mock('../../server/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.errors },
}));
vi.mock('../../server/modules/masquerade', () => ({
  getEffectiveUser: async (session: any, user: any) => ({ dbUser: session.effectiveUser ?? user.dbUser }),
}));
vi.mock('../../server/storage', () => ({
  storage: { logs: { getLogsByHostEntityIds: mocks.logs } },
  createCommStorage: () => ({ getCommWithDetails: mocks.record }),
  createCommSmsOptinStorage: () => ({}),
  createCommEmailOptinStorage: () => ({}),
  createCommPostalOptinStorage: () => ({}),
  createCommInappStorage: () => ({}),
}));
vi.mock('../../server/storage/comm-tags', () => ({ createCommTagsStorage: () => ({}) }));
vi.mock('../../server/services/comm/senders/sms', () => ({ sendSms: vi.fn() }));
vi.mock('../../server/services/comm/senders/email', () => ({ sendEmail: vi.fn() }));
vi.mock('../../server/services/comm/senders/postal', () => ({ sendPostal: vi.fn() }));
vi.mock('../../server/services/comm/senders/inapp', () => ({
  sendInapp: vi.fn(), markInappAsRead: vi.fn(), markAllInappAsRead: vi.fn(),
}));
vi.mock('../../server/services/comm/callback-handlers/handler', () => ({ handleStatusCallback: vi.fn() }));
vi.mock('../../server/services/comm/validators/address-verification', () => ({ verifyPostalAddress: vi.fn() }));
vi.mock('../../server/services/comm/validators/address', () => ({
  mapVerificationToDeliverabilityStatus: vi.fn(), isTerminalDeliverabilityStatus: vi.fn(),
}));
vi.mock('../../server/services/websocket', () => ({ broadcastAlertUpdate: vi.fn() }));
vi.mock('../../server/modules/contact-links', () => ({ resolveContactLinks: async () => ({ mainLink: null }) }));
vi.mock('../../server/services/maintenance-flag', () => ({ sendIfMaintenanceRefusal: vi.fn() }));
vi.mock('../../server/services/webclient', () => ({ wcRequest: vi.fn() }));
vi.mock('../../server/services/webclient/wc-vendor-context', () => ({ WcVendorError: class extends Error {} }));
vi.mock('../../server/delivery/shape', () => ({
  deriveEmailPlainText: vi.fn(), isSafeRelativePath: vi.fn(),
}));

import { registerCommRoutes } from '../../server/modules/comm';

const actor = { id: 'supervisor', email: 'supervisor@example.test' } as User;
const other = { id: 'other', email: 'other@example.test' } as User;
const admin = { id: 'admin', email: 'admin@example.test' } as User;
let enabled: boolean;
let permissions: Record<string, string[]>;
let links: string[];
let sheets: Record<string, Record<string, unknown>>;
const db = {
  comm: { getComm: vi.fn(async (id: string) => id === 'comm-1' ? { id, contactId: 'same-recipient' } : undefined) },
  edlsAssignments: { getSheetIdsByCommId: vi.fn(async (id: string) => id === 'comm-1' ? [...links] : []) },
  edlsSheets: { get: vi.fn(async (id: string) => sheets[id] ? { ...sheets[id] } : undefined) },
};
const auth = {
  hasPermission: async (id: string, key: string) => (permissions[id] ?? []).includes(key),
  getUserPermissions: async (id: string) => permissions[id] ?? [],
  getUser: async () => actor,
};
const component = async (id: string) => id === 'edls' && enabled;
const evaluate = (id = 'comm-1', user: User | null = actor, entityData?: Record<string, unknown>) =>
  evaluatePolicy(user, 'comm.view', db, auth, component, id, undefined, { entityData });

beforeEach(() => {
  vi.clearAllMocks();
  clearAccessCache();
  enabled = true;
  permissions = { supervisor: ['edls.supervisor'], admin: ['admin'] };
  links = ['sheet-1'];
  sheets = { 'sheet-1': { id: 'sheet-1', status: 'draft', supervisor: actor.id, assignee: null } };
  mocks.record.mockImplementation(async (id: string) => id === 'comm-1' ? { id, contactId: 'same-recipient' } : undefined);
  mocks.logs.mockResolvedValue([{ id: 'log-1', message: 'Delivery recorded' }]);
  wireCommViewAccess();
  initAccessControl(auth, db, component);
});

describe('comm.view', () => {
  it.each(['admin', 'staff', 'workers.comm'])('grants %s independently of EDLS', async permission => {
    permissions[actor.id] = [permission];
    enabled = false;
    expect((await evaluate()).granted).toBe(true);
    expect(db.edlsAssignments.getSheetIdsByCommId).not.toHaveBeenCalled();
  });

  it('grants linked-sheet view without an edls.any permission or policy check', async () => {
    expect((await evaluate()).granted).toBe(true);
    expect(db.edlsAssignments.getSheetIdsByCommId).toHaveBeenCalledWith('comm-1');
    sheets['sheet-1'].supervisor = other.id;
    sheets['sheet-1'].assignee = actor.id;
    expect((await evaluate()).granted).toBe(true);
  });

  it('denies missing IDs, anonymous users, unrelated workers and unknown communications', async () => {
    expect((await evaluate('')).granted).toBe(false);
    expect((await evaluate('comm-1', null)).granted).toBe(false);
    permissions[actor.id] = ['workers.view'];
    expect((await evaluate()).granted).toBe(false);
    permissions[actor.id] = ['edls.supervisor'];
    expect((await evaluate('another-comm-to-the-same-recipient')).granted).toBe(false);
    links = [];
    expect((await evaluate()).granted).toBe(false);
  });

  it('never touches optional tables while EDLS is disabled', async () => {
    enabled = false;
    expect((await evaluate()).granted).toBe(false);
    expect(db.edlsAssignments.getSheetIdsByCommId).not.toHaveBeenCalled();
  });

  it('uses stored sheet data, not caller-supplied sheet or supervisor claims', async () => {
    sheets['sheet-1'].supervisor = other.id;
    expect((await evaluate('comm-1', actor, { supervisor: actor.id, sheetId: 'fake' })).granted).toBe(false);
  });

  it('accepts any genuinely linked visible sheet, but not missing or unrelated sheets', async () => {
    sheets['sheet-1'].supervisor = other.id;
    sheets['sheet-2'] = { id: 'sheet-2', supervisor: actor.id, status: 'lock' };
    links = ['missing', 'sheet-1', 'sheet-2'];
    expect((await evaluate()).granted).toBe(true);
    links = ['missing', 'sheet-1'];
    expect((await evaluate()).granted).toBe(false);
  });

  it('revokes immediately after reassignment, unlinking, permission removal or component disable', async () => {
    // Warm the delegated sheet cache before the comm check.
    expect((await evaluatePolicy(actor, 'edls.sheet.view', db, auth, component, 'sheet-1')).granted).toBe(true);
    expect((await evaluate()).granted).toBe(true);
    sheets['sheet-1'].supervisor = other.id;
    expect((await evaluate()).granted).toBe(false);
    sheets['sheet-1'].supervisor = actor.id;
    expect((await evaluate()).granted).toBe(true);
    links = [];
    expect((await evaluate()).granted).toBe(false);
    links = ['sheet-1'];
    expect((await evaluate()).granted).toBe(true);
    permissions[actor.id] = [];
    expect((await evaluate()).granted).toBe(false);
    permissions[actor.id] = ['edls.supervisor'];
    enabled = false;
    expect((await evaluate()).granted).toBe(false);
  });

  it('fails closed when the resolver is unavailable or relationship storage fails', async () => {
    setLinkedCommViewResolver(null);
    expect((await evaluate()).granted).toBe(false);
    wireCommViewAccess();
    db.edlsAssignments.getSheetIdsByCommId.mockRejectedValueOnce(new Error('lookup failed'));
    expect((await evaluate()).granted).toBe(false);
    expect(mocks.errors).toHaveBeenCalled();
    expect(policy.skipCache).toBe(true);
  });
});

describe('existing communication read routes', () => {
  type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
  function routes() {
    const registered = new Map<string, Handler[]>();
    const app = Object.fromEntries(['get', 'post', 'put', 'patch'].map(method => [
      method, (path: string, ...handlers: Handler[]) => registered.set(`${method} ${path}`, handlers),
    ]));
    registerCommRoutes(
      app as unknown as Express,
      (_req, _res, next) => next(),
      key => (_req, res, next) => {
        // Only staff, never the comm policy, may write.
        if (key === 'staff') res.status(403).json({ message: 'staff required' });
        else next();
      },
      requireAccess,
    );
    return registered;
  }
  async function request(path: string, effectiveUser = actor, method = 'get', id = 'comm-1') {
    const handlers = routes().get(`${method} ${path}`)!;
    const req = {
      params: { id }, query: {}, body: {}, path, method,
      user: { claims: { sub: admin.id }, dbUser: admin },
      session: { effectiveUser },
    } as unknown as Request;
    const response = {
      statusCode: 200, body: undefined as any, headers: {} as Record<string, string>,
      status(code: number) { this.statusCode = code; return this; },
      json(body: unknown) { this.body = body; return this; },
      setHeader(key: string, value: string) { this.headers[key] = value; },
      vary(key: string) { this.headers.Vary = key; },
    };
    for (const handler of handlers) {
      let next = false;
      await handler(req, response as unknown as Response, (() => { next = true; }) as NextFunction);
      if (!next) break;
    }
    return response;
  }

  it.each(['/api/comm/:id', '/api/comm/:id/logs'])('protects %s by comm ID and effective viewer', async path => {
    const allowed = await request(path);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers['Cache-Control']).toBe('private, no-store');
    expect(allowed.headers.Vary).toBe('Cookie');
    const denied = await request(path, other);
    expect(denied.statusCode).toBe(403);
    expect(denied.body.policy).toBe('comm.view');
    expect(denied.body.entityId).toBe('comm-1');
    expect((await request(path, actor)).statusCode).toBe(200);
    links = [];
    expect((await request(path, actor)).statusCode).toBe(403);
  });

  it('scopes history to the named communication and preserves broad-reader 404s', async () => {
    const history = await request('/api/comm/:id/logs');
    expect(history.body).toEqual([{ id: 'log-1', message: 'Delivery recorded' }]);
    expect(mocks.logs).toHaveBeenCalledWith(expect.objectContaining({
      hostEntityIds: ['comm-1'], entityIds: ['comm-1'],
    }));
    for (const path of ['/api/comm/:id', '/api/comm/:id/logs']) {
      expect((await request(path, admin, 'get', 'missing')).statusCode).toBe(404);
    }
  });

  it('does not grant write access along with communication viewing', async () => {
    expect((await request('/api/comm/:id', actor, 'put')).statusCode).toBe(403);
  });
});
