import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { insertTrustBenefitSchema, optionsColor, trustBenefits } from "@shared/schema";
import { isValidHexColor } from "@shared/utils/color";
import { findSystemHelpsForPath, getAllSystemHelps } from "../../server/help/system";
import { optionsMetadata } from "../../server/storage/unified-options";
import { validateOptionTypeSpecificFields } from "../../server/modules/options-write-rules";
import { getMetadataContextForTable } from "../../server/storage/entity-metadata-record-tables";

describe("trust benefit color options", () => {
  it("registers a named, validated color option in unified options", () => {
    const metadata = optionsMetadata.color;
    expect(metadata).toMatchObject({
      table: optionsColor,
      requiredFields: ["name", "color"],
      supportsSequencing: true,
    });
    expect(metadata.fields.find((field) => field.name === "color")).toMatchObject({
      inputType: "color",
      required: true,
      showInTable: true,
    });

    expect(isValidHexColor("#12aBef")).toBe(true);
    for (const value of ["red", "#123", "#12345g", "rgb(1,2,3)", null]) {
      expect(isValidHexColor(value)).toBe(false);
      expect(validateOptionTypeSpecificFields("color", { color: value })).toMatch(/six-digit hex/);
    }
    expect(validateOptionTypeSpecificFields("color", { color: "#12aBef" })).toBeNull();
  });

  it("stores an optional option id with a restrictive foreign key, not a raw color", () => {
    const benefitColumns = getTableConfig(trustBenefits).columns;
    expect(benefitColumns.map((column) => column.name)).toContain("color_option_id");
    expect(benefitColumns.map((column) => column.name)).not.toContain("color");
    const colorFk = getTableConfig(trustBenefits).foreignKeys.find(
      (foreignKey) => foreignKey.reference().columns[0] === trustBenefits.colorOptionId,
    );
    expect(colorFk?.onDelete).toBe("restrict");
    expect(insertTrustBenefitSchema.safeParse({ name: "Medical", colorOptionId: null }).success).toBe(true);
    expect(insertTrustBenefitSchema.safeParse({ name: "Medical", colorOptionId: "color-option-id" }).success).toBe(true);
    expect(getMetadataContextForTable("options_color")?.label).toBe("Benefit Colors");
  });

  it("shows focused guidance only on benefit create/edit and color option management", () => {
    const help = getAllSystemHelps();
    expect(help.find((entry) => entry.id === "system:trust-benefit-color-selection")?.details)
      .toContain("<strong>No color</strong>");
    expect(help.find((entry) => entry.id === "system:trust-benefit-color-options")?.details)
      .toContain("six-digit hex");

    expect(findSystemHelpsForPath("/trust-benefits/add").some(
      (entry) => entry.id === "system:trust-benefit-color-selection",
    )).toBe(true);
    expect(findSystemHelpsForPath("/trust-benefits/benefit-123/edit").some(
      (entry) => entry.id === "system:trust-benefit-color-selection",
    )).toBe(true);
    for (const path of ["/trust-benefits", "/trust-benefits/benefit-123", "/config/options/color/export"]) {
      expect(findSystemHelpsForPath(path).some(
        (entry) => entry.id === "system:trust-benefit-color-selection",
      )).toBe(false);
    }
    expect(findSystemHelpsForPath("/config/options/color/list").some(
      (entry) => entry.id === "system:trust-benefit-color-options",
    )).toBe(true);
    expect(findSystemHelpsForPath("/config/options/gender/list").some(
      (entry) => entry.id === "system:trust-benefit-color-options",
    )).toBe(false);
  });
});
