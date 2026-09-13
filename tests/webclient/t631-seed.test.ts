/**
 * Seeding the T631 connection.
 *
 * The interesting cases are all collisions. T631 is deliberately not a
 * singleton, so nothing in the schema stops two boots that both saw no
 * connection from each creating one — and two enabled connections mean an
 * ambiguous default and a scheduled sync that fails every time it runs. The
 * seed therefore claims a stable `sirius_id` and lets the database arbitrate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const SEED_SIRIUS_ID = "seed.sitespecific.t631.client";

const isComponentEnabled = vi.fn<(id: string) => Promise<boolean>>();
const create = vi.fn();
const upsertSubsidiary = vi.fn();
const getByKindAndPlugin = vi.fn();
const findBySiriusId = vi.fn();
const loggerInfo = vi.fn();
const loggerError = vi.fn();

vi.mock("../../server/modules/components", () => ({
  isComponentEnabled: (id: string) => isComponentEnabled(id),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    pluginConfigs: {
      getByKindAndPlugin: (...args: unknown[]) => getByKindAndPlugin(...args),
      create: (...args: unknown[]) => create(...args),
      upsertSubsidiary: (...args: unknown[]) => upsertSubsidiary(...args),
      findBySiriusId: (...args: unknown[]) => findBySiriusId(...args),
    },
  },
}));

vi.mock("../../server/storage/transaction-context", () => ({
  runInTransaction: (fn: () => Promise<unknown>) => fn(),
}));

vi.mock("../../server/middleware/request-context", () => ({
  withFrameworkWrite: (fn: () => Promise<unknown>) => fn(),
}));

vi.mock("../../server/logger", () => ({
  logger: {
    info: (...args: unknown[]) => loggerInfo(...args),
    error: (...args: unknown[]) => loggerError(...args),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

/** The violation Postgres raises when the seed's identifier is already taken. */
function uniqueViolation() {
  return Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint: "plugin_configs_sirius_id_unique",
  });
}

async function seed() {
  const { seedT631VendorConfig } = await import(
    "../../server/plugins/wc-vendors/plugins/t631"
  );
  await seedT631VendorConfig();
}

describe("seedT631VendorConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isComponentEnabled.mockResolvedValue(true);
    getByKindAndPlugin.mockResolvedValue([]);
    create.mockResolvedValue({ id: "new-row" });
    upsertSubsidiary.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("does nothing when the component is off", async () => {
    isComponentEnabled.mockResolvedValue(false);
    await seed();
    expect(getByKindAndPlugin).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("creates the connection with its stable identifier and a subsidiary row", async () => {
    await seed();
    expect(create).toHaveBeenCalledTimes(1);
    const written = create.mock.calls[0][0];
    expect(written.siriusId).toBe(SEED_SIRIUS_ID);
    expect(written.pluginKind).toBe("wc-vendors");
    expect(written.pluginId).toBe("t631");
    expect(written.enabled).toBe(true);
    // The row names the secret; it never carries a token value.
    expect(written.data.secretName).toBe("SITESPECIFIC_T631_CLIENT_CREDENTIAL");
    expect(JSON.stringify(written.data)).not.toContain("accessToken");
    expect(upsertSubsidiary).toHaveBeenCalledWith("wc-vendors", { id: "new-row" });
  });

  it("leaves an existing connection alone, however the operator has edited it", async () => {
    getByKindAndPlugin.mockResolvedValue([
      { id: "existing", enabled: false, data: { secretName: "SOMETHING_ELSE" } },
    ]);
    await seed();
    expect(create).not.toHaveBeenCalled();
    expect(upsertSubsidiary).not.toHaveBeenCalled();
  });

  it("accepts losing the race to another process seeding the same connection", async () => {
    create.mockRejectedValue(uniqueViolation());
    findBySiriusId.mockResolvedValue({
      id: "won-by-someone-else",
      pluginKind: "wc-vendors",
      pluginId: "t631",
    });
    await seed();
    expect(loggerError).not.toHaveBeenCalled();
    expect(loggerInfo).toHaveBeenCalledWith(
      expect.stringContaining("seeded by another process"),
      expect.anything(),
    );
  });

  it("reports a collision with an unrelated record instead of calling it seeded", async () => {
    // Same error code, same constraint, entirely different cause: an operator
    // typed this sirius_id onto something else. Reading it as a won race would
    // leave the component with no connection and say nothing.
    create.mockRejectedValue(uniqueViolation());
    findBySiriusId.mockResolvedValue({
      id: "someone-elses-row",
      pluginKind: "charges",
      pluginId: "flat-fee",
    });
    await seed();
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining("identifier is in use"),
      expect.objectContaining({ conflictingPluginId: "flat-fee" }),
    );
    expect(loggerInfo).not.toHaveBeenCalledWith(
      expect.stringContaining("seeded by another process"),
      expect.anything(),
    );
  });

  it("reports any other failure rather than swallowing it", async () => {
    create.mockRejectedValue(new Error("connection terminated"));
    await seed();
    expect(findBySiriusId).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to seed"),
      expect.objectContaining({ error: "connection terminated" }),
    );
  });
});
