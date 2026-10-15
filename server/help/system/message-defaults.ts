import type { SystemHelpEntry } from "./index";

export const emailMessageDefaultsHelp: SystemHelpEntry = {
  id: "system:email-message-defaults",
  paths: ["/config/email"],
  summary: "Manage email delivery and the site-wide Email Letterhead automatically added before outgoing messages without changing saved templates.",
  details: `
    <h3>Purpose</h3>
    <p><strong>Email Letterhead</strong> adds fixed formatted content before every app-sent email body, including individual, bulk, automated, plain-text-only system messages, and offline records.</p>
    <h3>Before you start</h3>
    <p>You need admin access to change Email Settings. Email and Postal Letterheads are independent and remain saved when you change providers. Do not put recipient-specific tokens in site-wide defaults.</p>
    <h3>How to use this page</h3>
    <ol><li>Edit <strong>Email Letterhead</strong> using the formatted-content editor.</li>
    <li>Select <strong>Preview unsaved changes</strong> to see an example without saving or sending a message.</li>
    <li>Select <strong>Save defaults</strong> to apply the change site-wide.</li>
    <li>To remove the letterhead, select <strong>Clear Email Letterhead</strong>, then <strong>Save defaults</strong>.</li></ol>
    <h3>Results and status meanings</h3>
    <p>Successful saves affect subsequent sends, including queued work when it is delivered. HTML and plain-text alternatives include the same combined content. Templates and editable message bodies stay separate from the automatic letterhead. Communication history retains the content and settings used at sending; later edits do not rewrite it.</p>
    <h3>Limitations and common problems</h3>
    <p>A letterhead does not replace a required subject or body and does not change sending permissions, opt-in, allowlists, or provider requirements. A blank letterhead preserves unbranded delivery. Preview errors do not change saved settings; correct the content and try again.</p>
  `,
};

export const postalMessageDefaultsHelp: SystemHelpEntry = {
  id: "system:postal-message-defaults",
  paths: ["/config/postal"],
  summary: "Manage the independent Postal Letterhead, repeating Postal Footer, and optional page counts for letters composed by the app.",
  details: `
    <h3>Purpose</h3>
    <p><strong>Postal Letterhead</strong> appears once, at the beginning of the letter on its first page, below the reserved mailing-address area. <strong>Postal Footer</strong> repeats on every page, including continuation pages. <strong>Show page count</strong> adds accurate “Page X of Y” numbering below it. There is no separate postal header.</p>
    <h3>Before you start</h3>
    <p>You need admin access to change Postal Settings. Postal and Email Letterheads are independent and survive provider changes. These defaults are fixed formatted content; recipient-specific tokens are not supported.</p>
    <h3>How to use this page</h3>
    <ol><li>Edit <strong>Postal Letterhead</strong> and <strong>Postal Footer</strong> independently.</li>
    <li>Enable or disable <strong>Show page count</strong>.</li>
    <li>Select <strong>Preview unsaved changes</strong> to inspect an example first page and continuation page without saving or sending.</li>
    <li>Select <strong>Save defaults</strong> to apply the change. To remove content, use its <strong>Clear</strong> control and save. Clear both blocks and disable page counts to restore unbranded layout.</li></ol>
    <h3>Results and status meanings</h3>
    <p>Changes apply to subsequent individual, bulk, automated, and offline app-composed letters, including queued work when it is delivered. Delivery previews use the same PDF layout as sending. Preview guides are not printed. Saved templates and editable bodies do not acquire branding; history retains the effective content and layout settings actually used.</p>
    <h3>Limitations and common problems</h3>
    <p>Lob-hosted templates and already-rendered remote documents are sent unchanged: the app cannot add letterheads, footers, or page counts to them. Sending permissions, opt-in, allowlists, and provider rules still apply.</p>
    <p>Letterhead content must fit within 6.5 inches wide and 2 inches high; footer content must fit within 6.5 inches wide and 0.75 inches high. The renderer reserves body space, mailing-address/barcode space, and printer clearances. Oversized content, page breaks in branding, or clipped layout content is refused rather than overlapped. Reduce text, font size, spacing, or images and preview again.</p>
  `,
};

export const composeMessageDefaultsHelp: SystemHelpEntry = {
  id: "system:compose-message-defaults",
  paths: [
    "/workers/%/comm/send-email", "/users/%/comm/send-email",
    "/employer-contacts/%/comm/send-email", "/trust-provider-contacts/%/comm/send-email",
    "/workers/%/comm/send-postal", "/users/%/comm/send-postal",
    "/employer-contacts/%/comm/send-postal", "/trust-provider-contacts/%/comm/send-postal",
    "/bulk/%/message", "/admin/letter-templates/%",
  ],
  summary: "Write only your message body; site-wide branding is added automatically at delivery and stays separate from saved templates.",
  details: `
    <h3>Purpose</h3>
    <p>Delivery previews include the current site-wide defaults. Editable bodies and saved templates contain only message-specific content; do not copy the letterhead or footer into them.</p>
    <h3>Results and status meanings</h3>
    <p>Email uses the <strong>Email Letterhead</strong>, including in its plain-text alternative. App-composed postal letters use the independent <strong>Postal Letterhead</strong> once at the beginning of the first page, with <strong>Postal Footer</strong> and optional “Page X of Y” numbering repeated on every page. There is no separate postal header.</p>
    <p>The settings in effect when delivery runs apply to individual, bulk, automated, queued, and offline-record paths. Saving or previewing a template does not freeze site-wide settings. Communication history keeps the content and layout settings used for that communication.</p>
    <h3>Limitations and common problems</h3>
    <p>Lob-hosted templates and already-rendered remote documents remain unchanged. Blank defaults add nothing. Branding never replaces a required subject/body or bypasses permissions, opt-in, allowlists, or provider rules. Ask an admin to change site-wide defaults in Email Settings or Postal Settings. If a postal layout is refused, reduce oversized text, images, or table rows and preview again.</p>
  `,
};
