import type { SystemHelpEntry } from "./index";

export const trustBenefitColorSelectionHelp: SystemHelpEntry = {
  id: "system:trust-benefit-color-selection",
  paths: ["/trust-benefits/add", "/trust-benefits/%/edit"],
  summary: "Choose a configured color to tint this benefit’s icon, or select No color to leave it untinted.",
  details: `
    <h3>Purpose</h3>
    <p>Choose a shared color for this benefit’s icon. The available colors are maintained by administrators in Benefit Colors.</p>
    <h3>How to use this page</h3>
    <ol>
      <li>Open <strong>Color</strong> and choose a named color with its swatch, or choose <strong>No color</strong>.</li>
      <li>Save or add the benefit to store the selected color option.</li>
    </ol>
    <h3>Results and status meanings</h3>
    <p>A selected color tints the benefit icon in benefit and worker displays. <strong>No color</strong> leaves the benefit without its own tint; displays that support a benefit-type color may continue to show that type color.</p>
    <h3>Limitations and common problems</h3>
    <p>The form only offers configured colors. If the color you need is missing, ask an administrator to add it in Benefit Colors. A color option in use cannot be deleted until benefits stop referencing it.</p>
  `,
};

export const trustBenefitColorOptionsHelp: SystemHelpEntry = {
  id: "system:trust-benefit-color-options",
  paths: ["/config/options/color/list"],
  summary: "Maintain the named color swatches staff can select for trust benefit icons.",
  details: `
    <h3>Purpose</h3>
    <p>Manage the shared palette used to tint trust benefit icons.</p>
    <h3>How to use this page</h3>
    <ol>
      <li>Add a color with a distinct <strong>Name</strong> and a six-digit hex <strong>Color</strong>.</li>
      <li>Edit the name or swatch when the shared option should change for every benefit that uses it.</li>
      <li>Review references before deleting. A color used by a benefit cannot be deleted.</li>
    </ol>
    <h3>Results and status meanings</h3>
    <p>Benefits store a reference to the named option, so changing its swatch updates every benefit that uses it. Deleting an unused option removes it from future selections.</p>
    <h3>Limitations and common problems</h3>
    <p>Enter a six-digit hex value such as <strong>#336699</strong>. If deletion is refused, change the color on each referencing benefit or choose <strong>No color</strong> before trying again.</p>
  `,
};
