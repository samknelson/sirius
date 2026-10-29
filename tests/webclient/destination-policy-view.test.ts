import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WcVendorDestinationPolicy } from "../../client/src/components/wc-vendor-destination-policy";
import { describeVendorDestinationPolicy } from "../../server/services/webclient/endpoint-policy";

describe("destination policy presentation", () => {
  it.each([undefined, false, true])("shows the same network mode as the runtime resolver: %s", (flag) => {
    vi.stubEnv("WEBCLIENT_VENDOR_ALLOWED_HOSTS", JSON.stringify({
      test: { allowedHosts: ["api.example.com"], allowPrivateAddresses: flag },
    }));
    try {
      const policy = describeVendorDestinationPolicy({
        id: "test", service: "test", httpTransport: "webclient",
      }, (id) => id === "test");
      const html = renderToStaticMarkup(createElement(WcVendorDestinationPolicy, { policy }));
      expect(html).toContain(flag === true ? "Public and private addresses" : "Public addresses only");
      expect(html).toContain("Metadata, loopback and link-local destinations remain blocked");
    } finally { vi.unstubAllEnvs(); }
  });
  it("does not describe invalid policies as public-only or unrestricted", () => {
    vi.stubEnv("WEBCLIENT_VENDOR_ALLOWED_HOSTS", '{"test":[]}');
    try {
      const policy = describeVendorDestinationPolicy({
        id: "test", service: "test", httpTransport: "webclient",
      }, () => true);
      const html = renderToStaticMarkup(createElement(WcVendorDestinationPolicy, { policy }));
      expect(html).toContain("Unavailable (invalid policy)");
      expect(html).not.toContain("Public addresses only");
      expect(html).toContain("Invalid configuration refuses operations");
    } finally { vi.unstubAllEnvs(); }
  });
});
