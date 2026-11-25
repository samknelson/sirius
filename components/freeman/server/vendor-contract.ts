import '../../../server/plugins/wc-vendors/types';
declare module '../../../server/plugins/wc-vendors/types' {
 interface WcVendorOperations {
  "sitespecific.freeman.authorization.bearer": {
    args: { bearerCredential: string };
    result: {
      success: boolean;
      outcome: "success" | "network_error" | "http_error" | "malformed_response" | "unexpected_ping_status";
      status?: number;
      response?: unknown;
      error?: string;
    };
  };

 }
}

declare module '../../../server/services/maintenance-flag' {
 interface PackageExternalServices { 'Freeman EDLS': true; 'Freeman Authorization': true }
}
