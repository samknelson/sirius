import type { SystemHelpEntry } from "./index";

export const editorFormattingDetails = `
  <h3>Formatting rich content</h3>
  <p>New text starts in <strong>Normal</strong>: Arial, regular, 16px. The <strong>Paragraph</strong> choices apply Arial bold at 28px for Heading 1, 22px for Heading 2, and 18px for Heading 3. Choosing Normal again removes the previous heading size and bold; you can customize the text afterward. In a narrow editor, open <strong>More formatting</strong> for paragraph, font, and size controls.</p>
  <p>Color pickers include Fund Red #CC0D12, Black #000000, Dark Grey #241F21, and Light Grey #ECEAEA, plus other presets and custom colors. Select text for <strong>Text color</strong> or <strong>Highlight color</strong>.</p>
  <p>Use <strong>Background</strong> to color a whole block instead of highlighting text. Put the caret in the block, open Background, and review <strong>Background target</strong> and the “Will change” description. Select an ancestor <strong>Container</strong> to color a whole wrapper, such as a footer containing several paragraphs. A selection across blocks can color the selected blocks together. Mixed explicit backgrounds are identified.</p>
  <p><strong>Reset background</strong> removes the chosen target's own background; a parent background may still show through. Background changes never adjust text or link colors for contrast. Set those colors deliberately, then preview. <strong>Undo</strong> and <strong>Redo</strong> include formatting changes. HTML source lets you inspect the serialized content; unsafe or unsupported styles are removed when returning to Visual.</p>
`;

export const richEditorFormattingHelp: SystemHelpEntry = {
  id: "system:rich-editor-formatting",
  paths: ["/config/helps", "/config/site", "/config/workers/tos", "/ledger/accounts/%/settings",
    "/contract/%/article/%/edit", "/trust-benefits/%/edit", "/cardcheck-definitions/%/edit"],
  summary: "Use shared typography presets, Fund color swatches, and block backgrounds when editing formatted content.",
  details: editorFormattingDetails,
};
