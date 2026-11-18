import type { SystemHelpEntry } from "./index";

export const postalAddressLinesHelp: SystemHelpEntry = {
  id: "system:postal-address-lines",
  paths: [
    "/workers/%/addresses", "/employer-contacts/%/addresses",
    "/trust-provider-contacts/%/addresses", "/facility/%/addresses",
    "/users/%/contact/addresses",
  ],
  summary: "Save street and apartment information separately while keeping previous addresses available in history.",
  details: `
    <h3>Purpose</h3>
    <p>Use <strong>Address Line 1</strong> for the street address and <strong>Address Line 2</strong> for an apartment, suite, unit, or other second line. Leave the second line blank when it does not apply.</p>
    <h3>How to use this page</h3>
    <ol><li>Select <strong>Add Address</strong> when you have access to change addresses.</li>
    <li>Enter or parse the address, then review both lines. Use <strong>Edit</strong> in the address form to correct the components before saving.</li>
    <li>Save the address. To correct either line of a saved address, add a new address instead of editing its history.</li></ol>
    <h3>Results and status meanings</h3>
    <p>Different unit values are separate addresses. Existing primary-address protections still apply; adding an address does not always replace a worker-reported primary address. Deactivating an address retains it in history.</p>
    <h3>Limitations and common problems</h3>
    <p>Older addresses may still contain a unit in Address Line 1. The system does not guess how to split them. Correct them by adding a new address, or use an authoritative import with separate lines. Review parsed and suggested addresses carefully: a building-level lookup does not confirm a unit.</p>
  `,
};
