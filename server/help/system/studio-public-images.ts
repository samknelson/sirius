import type { SystemHelpEntry } from "./index";

export const studioPublicImagesHelp: SystemHelpEntry = {
  id: "system:studio-public-images",
  paths: ["/admin/letter-templates/%", "/bulk/%/message", "/workers/%/comm/send-email", "/workers/%/comm/send-postal", "/config/email", "/config/postal"],
  summary: "Use public image URLs in message content, or upload PNG/JPEG images when Studio has an existing supported owner.",
  details: `
    <h3>Before you start</h3><p>Uploads publish images immediately and permanently. Never upload confidential information. An administrator must configure the matching public area in Config → Entity Files and a recipient-reachable HTTPS PUBLIC_URL.</p>
    <h3>How to use this page</h3><ol><li>Open Template Studio for a saved letter template, existing bulk draft, or worker compose.</li><li>In image tools, enter an HTTPS Image URL or use Upload image if offered. Uploads accept PNG/JPEG up to 1 MB with bounded dimensions.</li><li>Review the image and apply your content changes. Saving content is separate from publishing the uploaded image.</li></ol>
    <h3>Results and status meanings</h3><p>Uploaded images belong to the saved template, bulk draft, or worker's separate public-files area. Multiple images may belong to the same record. Canceling, removing an HTML image, or deleting its owner does not delete published bytes or revoke URLs already sent to recipients.</p>
    <h3>Limitations and common problems</h3><p>Notifier settings, employer/provider compose, and message defaults do not offer uploads. Enter an externally hosted HTTPS image URL or edit an existing image instead; dropping or pasting files cannot enable uploads. Missing configuration, unavailable owners, permissions, private storage, and unsafe image files are refused. Ask an administrator to resolve configuration rather than making private attachments public. Existing letterheads and published image URLs remain usable.</p>`,
};
