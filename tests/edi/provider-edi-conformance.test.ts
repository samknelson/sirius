/**
 * The conformance contract every trust-provider EDI plugin has to satisfy,
 * whatever its format.
 *
 * These records are fixed-width files a third party parses by byte offset, so
 * the risks are structural and identical across providers: a record that is
 * not exactly as wide as its declared layout, a field that does not start
 * where the layout says it starts, a long value that shifts everything after
 * it, a null that pads with the wrong character, a constant that stops being
 * constant. Asserting those once here — driven by the registry, so a new
 * provider is covered the moment it registers — is what keeps each provider
 * suite down to what is genuinely its own (Kaiser's overpunch amounts,
 * HealthNet's member types).
 *
 * A CSV provider has no byte offsets, but the same risks in another shape: a
 * column out of order, a column added or dropped, a value holding a comma or
 * a quote that splits one cell into two. Those are asserted once here too.
 *
 * The expected layouts live in `fixtures/legacy-layouts.ts` and are
 * transcribed from the legacy PHP generators, not from the plugins.
 */
import { describe, expect, it } from "vitest";
import { parse } from "csv-parse/sync";
import { buildMemberUnits } from "../../server/plugins/trust/provider-edi/base";
import { LEGACY_CSV_LAYOUTS, LEGACY_LAYOUTS } from "./fixtures/legacy-layouts";
import {
  encoderFor,
  ediReadFixture,
  fieldSpans,
  padCell,
  registeredEdiPlugins,
  segmentStartRow,
  uniformRow,
} from "./fixtures/harness";

const plugins = registeredEdiPlugins();

describe("EDI-only personal field casing through every registered feed", () => {
  for (const plugin of plugins) {
    for (const blank of [null, ""] as const) {
      it(`${plugin.id} uppercases mixed-case people and preserves ${JSON.stringify(blank)} behavior`, async () => {
        const subscriber = Object.freeze({
          contactId: "sub-contact", workerSiriusId: "1234", ssn: "123456789",
          givenName: 'aNa,"Ann"', familyName: "deLaCruz".repeat(6),
          middleName: "joAnne", email: "aNa.Example@Example.com",
          birthDate: "1980-01-02", genderCode: "F",
        });
        const dependent = Object.freeze({
          ...subscriber, contactId: "dep-contact", workerSiriusId: "5678",
          givenName: "eLi", familyName: "McKay", middleName: "raE",
          email: "eLi.Example@Example.com",
          depWmbId: "1-dep-wmb", depWorkerId: "dep-worker", sourceRelationId: "rel",
          relationId: "rel", subscriberWorkerId: "sub-worker", relationSiriusId: "SP",
          benefitId: "benefit", year: 2026, month: 10,
        });
        const missing = Object.freeze({
          ...dependent, depWmbId: "2-blank-wmb", depWorkerId: "blank-worker",
          contactId: "blank-contact", relationId: "blank-rel",
          givenName: blank, familyName: blank, middleName: blank, email: blank,
        });
        const qmsco = Object.freeze({
          ...missing, depWmbId: "3-qmsco-wmb", depWorkerId: "qmsco-worker",
          contactId: "qmsco-contact", relationId: "qmsco-rel", relationSiriusId: "QMSCO",
        });
        const postal = Object.freeze({
          street: "12 Mixed Case St", street2: "Suite 4B", city: "Los Angeles", state: "Ca", postalCode: "90001",
        });
        const local11 = plugin.id.endsWith("-local11");
        const hours = Object.freeze({
          id: "wmb", workerName: 'aNa,"Ann" deLaCruz', workerSsn: subscriber.ssn,
          workerId: "sub-worker", employerName: "Mixed Case Employer", employerCode: "Emp",
          hoursYear: 2026, hoursMonth: 10, hoursAmt: 123, hoursType: "Regular",
        });
        const needsExtraRead = /-(healthnet|delta|expressscripts|carelon)$/.test(plugin.id);
        const wmb = { id: "wmb", workerId: "sub-worker", benefitId: "benefit", employerId: "employer", sourceRelationId: null, year: 2026, month: 10 };
        // One coverage start per person, as the lifecycle-event read answers it.
        const history = [wmb, ...[dependent, missing, qmsco].map(dep => ({
          id: dep.depWmbId, workerId: dep.depWorkerId, benefitId: dep.benefitId, year: dep.year, month: dep.month,
        }))].map(anchor => segmentStartRow(anchor, { restart: 10 }));
        const fixture = ediReadFixture(local11 ? [[hours]] : [
          [wmb],
          [{ id: "benefit", siriusId: plugin.benefitSiriusIds![0] }],
          [dependent, missing, qmsco], history,
          [{ ...subscriber, workerId: "sub-worker" }],
          [subscriber, dependent, missing, qmsco].map(person => ({ ...postal, contactId: person.contactId })),
          [{ contactId: subscriber.contactId, phoneNumber: "2135550100" }],
          ...(needsExtraRead ? [[]] : []),
        ]);
        // Check the shared model as well as the real provider mapper/serializer.
        // A fresh fixture is needed because scripted reads are consumed once.
        if (!local11) {
          const modelFixture = ediReadFixture([
            [wmb], [{ id: "benefit", siriusId: plugin.benefitSiriusIds![0] }],
            [dependent, missing, qmsco], history,
            [{ ...subscriber, workerId: "sub-worker" }],
            [subscriber, dependent, missing, qmsco].map(person => ({ ...postal, contactId: person.contactId })),
            [],
          ]);
          const [unit] = await buildMemberUnits(["wmb"], modelFixture.ctx);
          expect(unit.subscriber).toMatchObject({
            givenName: 'ANA,"ANN"', middleName: "JOANNE", email: "ANA.EXAMPLE@EXAMPLE.COM",
            postal, genderCode: "F", workerSiriusId: "1234",
          });
          expect(unit.dependents.find(d => d.relationId === "blank-rel")).toMatchObject({
            givenName: blank, familyName: blank, middleName: blank, email: blank,
          });
          modelFixture.assertReadsConsumed();
        }
        const rows = await plugin.processBatch(["wmb"], fixture.ctx);
        fixture.assertReadsConsumed();
        const esi = plugin.id.endsWith("-expressscripts");
        expect(rows).toHaveLength(local11 ? 1 : esi ? 3 : 4);
        for (const [i, row] of rows.entries()) {
          const source = i === 0 ? subscriber : i === 1 ? dependent : missing;
          const expected: Record<string, string> = local11
            ? { workerName: 'ANA,"ANN" DELACRUZ' }
            : {
                firstName: source.givenName?.toUpperCase() ?? "",
                lastName: source.familyName?.toUpperCase() ?? "",
                middleName: source.middleName?.toUpperCase() ?? "",
                middleInitial: (source.middleName?.toUpperCase() ?? "").slice(0, 1),
                subscriberName: 'ANA,"ANN" ' + subscriber.familyName.toUpperCase(),
                memberName: [source.givenName, source.familyName].filter(Boolean).join(" ").toUpperCase(),
                email: source.email?.toUpperCase() ??
                  (plugin.id.endsWith("-hinge") && i === 2 ? "ANA.EXAMPLE@EXAMPLE.COM" : ""),
              };
          // Empty strings also trigger Hinge's ordinary-dependent fallback.
          if (plugin.id.endsWith("-hinge") && i === 2) expected.email = "ANA.EXAMPLE@EXAMPLE.COM";
          for (const key of Object.keys(expected)) {
            if (key in row) expect(row[key], key).toBe(expected[key]);
          }
          const encoded = plugin.encodeRow(row, fixture.ctx);
          const expectedRow = { ...row, ...expected };
          if (plugin.csvFields) {
            const cells = parse(encoded)[0] as string[];
            expect(cells).toEqual(plugin.csvFields!.map(f => f.get?.(expectedRow) ?? ""));
            if (i === 0) expect(encoded).toContain('"ANA,""ANN""');
          } else {
            // A fixed-width feed registered without a legacy pin still gets
            // casing/structural checks from its declared layout here; the
            // separate fixture-inventory test is what reports the missing pin.
            const layout = LEGACY_LAYOUTS[plugin.id] ?? {
              totalWidth: plugin.ediFields.reduce((sum, f) => sum + f.width, 0),
              fields: plugin.ediFields.map(f => [f.name, f.width] as const),
            };
            expect(encoded).toHaveLength(layout.totalWidth);
            for (const [j, span] of fieldSpans(layout).entries()) {
              const field = plugin.ediFields[j];
              expect(encoded.slice(span.start, span.start + span.width), span.name)
                .toBe(padCell(field.get?.(expectedRow) ?? "", span.width, field.align));
            }
          }
          if (local11) {
            expect(row.employerName).toBe("Mixed Case Employer");
            expect(row.hoursType).toBe("Regular");
          } else {
            expect(row.city).toBe("Los Angeles");
            if ("street" in row) expect(row.street).toBe(postal.street);
            if ("street2" in row) expect(row.street2).toBe(postal.street2);
            if ("address2" in row) expect(row.address2).toBe(postal.street2);
          }
        }
        // Frozen source records also make accidental in-place normalization throw.
        expect(subscriber.email).toBe("aNa.Example@Example.com");
        expect(dependent.givenName).toBe("eLi");
        expect(hours.workerName).toBe('aNa,"Ann" deLaCruz');
      });
    }
  }
});

describe("every registered EDI provider has an expected layout", () => {
  it("at least one provider is registered", () => {
    expect(plugins.length).toBeGreaterThan(0);
  });

  for (const plugin of plugins) {
    it(`${plugin.id} has a layout fixture`, () => {
      expect(
        LEGACY_LAYOUTS[plugin.id] ?? LEGACY_CSV_LAYOUTS[plugin.id],
        `Trust-provider EDI plugin '${plugin.id}' has no expected layout, so nothing ` +
          `checks the file it produces. Add an entry keyed '${plugin.id}' to ` +
          `tests/edi/fixtures/legacy-layouts.ts, transcribed from the format spec ` +
          `and not copied from the plugin: for a fixed-width file, its authoritative ` +
          `field names, order, and widths plus the total record width ` +
          `(LEGACY_LAYOUTS); for a CSV file, its column names and order ` +
          `(LEGACY_CSV_LAYOUTS).`,
      ).toBeDefined();
    });

    it(`${plugin.id} is pinned in the format it produces`, () => {
      // A fixed-width pin for a CSV feed (or the reverse) would skip every
      // check that applies to the file actually delivered.
      const isCsv = plugin.csvFields !== undefined;
      expect(
        LEGACY_LAYOUTS[plugin.id] !== undefined && isCsv,
        `'${plugin.id}' produces CSV but is pinned as fixed-width.`,
      ).toBe(false);
      expect(
        LEGACY_CSV_LAYOUTS[plugin.id] !== undefined && !isCsv,
        `'${plugin.id}' produces fixed-width records but is pinned as CSV.`,
      ).toBe(false);
    });
  }

  for (const id of [...Object.keys(LEGACY_LAYOUTS), ...Object.keys(LEGACY_CSV_LAYOUTS)]) {
    it(`layout fixture '${id}' still has a registered plugin`, () => {
      expect(
        plugins.some((p) => p.id === id),
        `tests/edi/fixtures/legacy-layouts.ts pins a layout for '${id}', but no ` +
          `such plugin is registered. Remove the fixture, or fix the key.`,
      ).toBe(true);
    });
  }
});

for (const plugin of plugins) {
  const layout = LEGACY_LAYOUTS[plugin.id];
  // A missing fixture is already a failure above; skip the rest for that
  // plugin rather than reporting the same gap once per invariant.
  if (!layout) continue;

  describe(`${plugin.id} conformance`, () => {
    const spans = fieldSpans(layout);
    const encode = encoderFor(plugin);
    const fields = plugin.ediFields;

    // Probe rows. Every field's `get` sees the same value, so a provider's
    // field table is exercised without the harness knowing its row keys.
    const OVERFLOW = "X".repeat(Math.max(...layout.fields.map(([, w]) => w)) + 10);
    const rows = {
      absent: {} as Record<string, unknown>,
      nulls: uniformRow(null),
      short: uniformRow("7"),
      overflow: uniformRow(OVERFLOW),
    };

    it("declares the expected field table (names, widths, order)", () => {
      expect(fields.map((f) => [f.name, f.width])).toEqual(
        layout.fields.map(([name, width]) => [name, width]),
      );
    });

    it(`declared widths sum to the record width (${layout.totalWidth})`, () => {
      expect(fields.reduce((sum, f) => sum + f.width, 0)).toBe(layout.totalWidth);
    });

    for (const [label, row] of Object.entries(rows)) {
      it(`encodes a ${label} row exactly ${layout.totalWidth} bytes wide`, () => {
        expect(encode(row).length).toBe(layout.totalWidth);
      });

      it(`places every field at its expected offset (${label} row)`, () => {
        const record = encode(row);
        const misplaced = spans
          .map((span, i) => {
            const field = fields[i];
            const raw = field?.get ? field.get(row) : "";
            const expected = padCell(raw, span.width, field?.align);
            const actual = record.slice(span.start, span.start + span.width);
            return actual === expected
              ? null
              : `${span.name} @${span.start}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
          })
          .filter(Boolean);
        expect(misplaced).toEqual([]);
      });
    }

    it("pads short values with spaces (left) or zeros (right), never shifting a field", () => {
      const record = encode(rows.short);
      const bad = spans
        .map((span, i) => {
          const field = fields[i];
          const raw = (field?.get ? field.get(rows.short) : "").slice(0, span.width);
          const cell = record.slice(span.start, span.start + span.width);
          const fill = span.width - raw.length;
          if (fill <= 0) return null;
          const ok =
            field?.align === "right"
              ? cell === "0".repeat(fill) + raw
              : cell === raw + " ".repeat(fill);
          return ok
            ? null
            : `${span.name}: ${field?.align === "right" ? "zero" : "space"}-padding expected around ${JSON.stringify(raw)}, got ${JSON.stringify(cell)}`;
        })
        .filter(Boolean);
      expect(bad).toEqual([]);
    });

    it("truncates over-width values to the field width", () => {
      const record = encode(rows.overflow);
      const truncated = spans.filter((span, i) => {
        const field = fields[i];
        return (field?.get ? field.get(rows.overflow) : "").length > span.width;
      });
      // Guard against a vacuous pass: the probe must actually overflow fields.
      expect(truncated.length).toBeGreaterThan(0);
      const bad = truncated
        .map((span) => {
          const cell = record.slice(span.start, span.start + span.width);
          return cell.length === span.width && !cell.includes(" ")
            ? null
            : `${span.name}: expected a full ${span.width}-byte cell, got ${JSON.stringify(cell)}`;
        })
        .filter(Boolean);
      expect(bad).toEqual([]);
    });

    it("treats a null value the same as an absent one", () => {
      expect(encode(rows.nulls)).toBe(encode(rows.absent));
    });

    it("emits pure padding for fields with no value source", () => {
      const record = encode(rows.overflow);
      const bad = spans
        .map((span, i) => {
          const field = fields[i];
          if (field?.get) return null;
          const cell = record.slice(span.start, span.start + span.width);
          const expected = padCell("", span.width, field?.align);
          return cell === expected
            ? null
            : `${span.name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(cell)}`;
        })
        .filter(Boolean);
      expect(bad).toEqual([]);
    });

    it("emits constant fields identically whatever the row holds", () => {
      const encoded = Object.fromEntries(
        Object.entries(rows).map(([label, row]) => [label, encode(row)]),
      );
      const constants = spans.filter((_span, i) => {
        const get = fields[i]?.get;
        if (!get) return false;
        // Row-independent output for every probe row ⇒ a constant.
        const values = Object.values(rows).map((row) => get(row));
        return new Set(values).size === 1 && values[0] !== "";
      });
      const bad = constants
        .map((span) => {
          const cells = Object.entries(encoded).map(
            ([label, record]) =>
              [label, record.slice(span.start, span.start + span.width)] as const,
          );
          const distinct = new Set(cells.map(([, cell]) => cell));
          return distinct.size === 1
            ? null
            : `${span.name}: constant varied by row — ${JSON.stringify(Object.fromEntries(cells))}`;
        })
        .filter(Boolean);
      expect(bad).toEqual([]);
    });
  });
}

for (const plugin of plugins) {
  const layout = LEGACY_CSV_LAYOUTS[plugin.id];
  if (!layout) continue;

  describe(`${plugin.id} conformance (CSV)`, () => {
    const encode = encoderFor(plugin);
    const fields = plugin.csvFields ?? [];
    // Read the record back with an independent CSV reader, not the plugin's
    // own escaping, so a cell that splits or merges is seen as a carrier
    // would see it.
    const cellsOf = (record: string): string[][] =>
      parse(record, { relax_column_count: true, skip_empty_lines: false });

    const rows = {
      absent: {} as Record<string, unknown>,
      nulls: uniformRow(null),
      short: uniformRow("7"),
      delimiters: uniformRow('Éva, "Q"\r\nnext'),
    };

    it("declares the expected columns (names, order)", () => {
      expect(fields.map((f) => f.name)).toEqual([...layout.columns]);
    });

    for (const [label, row] of Object.entries(rows)) {
      it(`encodes a ${label} row as one record of ${layout.columns.length} cells, each in its column`, () => {
        const records = cellsOf(encode(row));
        expect(records).toHaveLength(1);
        expect(records[0]).toEqual(fields.map((f) => (f.get ? f.get(row) : "")));
        expect(records[0]).toHaveLength(layout.columns.length);
      });
    }

    it("treats a null value the same as an absent one", () => {
      expect(encode(rows.nulls)).toBe(encode(rows.absent));
    });
  });
}
