import { useQuery } from "@tanstack/react-query";

export interface AddressValidationConfig {
  mode: "local" | "google";
  local: {
    enabled: boolean;
    countries: string[];
    strictValidation: boolean;
  };
  google: {
    enabled: boolean;
    /** Legacy read-only field; Google credentials now belong to WC vendor configs. */
    apiKeyName?: string;
    components: {
      country: boolean;
      administrative_area_level_1: boolean;
      postal_code: boolean;
    };
  };
  fallback: {
    useLocalOnGoogleFailure: boolean;
    logValidationAttempts: boolean;
  };
}

export function useAddressValidationConfig() {
  return useQuery<AddressValidationConfig>({
    queryKey: ["/api/variables/address_validation_config"],
    queryFn: async () => {
      const response = await fetch("/api/variables/address_validation_config");
      if (!response.ok) {
        throw new Error("Failed to fetch address validation config");
      }
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}