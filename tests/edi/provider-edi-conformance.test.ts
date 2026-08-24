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
 * The expected layouts live in `fixtures/legacy-layouts.ts` and are
 * transcribed from the legacy PHP generators, not from the plugins.
 */
import { describe, expect, it } from "vitest";
import { LEGACY_LAYOUTS } from "./fixtures/legacy-layouts";
import {
  encoderFor,
  fieldSpans,
  padCell,
  registeredEdiPlugins,
  uniformRow,
} from "./fixtures/harness";

const plugins = registeredEdiPlugins();

describe("every registered EDI provider has an expected layout", () => {
  it("at least one provider is registered", () => {
    expect(plugins.length).toBeGreaterThan(0);
  });

  for (const plugin of plugins) {
    it(`${plugin.id} has a layout fixture`, () => {
      expect(
        LEGACY_LAYOUTS[plugin.id],
        `Trust-provider EDI plugin '${plugin.id}' has no expected layout, so nothing ` +
          `checks the file it produces. Add an entry keyed '${plugin.id}' to ` +
          `tests/edi/fixtures/legacy-layouts.ts: its authoritative field names, ` +
          `order, and widths (transcribed from the format spec, not copied from ` +
          `the plugin), plus the total record width.`,
      ).toBeDefined();
    });
  }

  for (const id of Object.keys(LEGACY_LAYOUTS)) {
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
