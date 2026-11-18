import { useState, useCallback, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface AddressInput {
  street: string;
  street2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface AddressValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions?: {
    street?: string;
    street2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  source: "local" | "google";
}

export function useAddressValidation() {
  const [lastValidationResult, setLastValidationResult] = useState<AddressValidationResult | null>(null);
  const [lastValidatedSnapshot, setLastValidatedSnapshot] = useState<string>("");
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const validateMutation = useMutation({
    mutationFn: async (address: AddressInput): Promise<AddressValidationResult> => {
      return (await apiRequest("POST", "/api/addresses/validate", address)) as unknown as AddressValidationResult;
    },
    onSuccess: (result, variables) => {
      const snapshot = JSON.stringify(variables);
      setLastValidationResult(result);
      setLastValidatedSnapshot(snapshot);
    },
    onError: (error) => {
      console.error("Address validation failed:", error);
      setLastValidationResult({
        isValid: false,
        errors: ["Validation service temporarily unavailable"],
        warnings: [],
        source: "local",
      });
    },
  });

  const validateAddressDebounced = useCallback((address: AddressInput) => {
    // Clear previous timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Only validate if all required fields are present and non-empty
    const hasAllFields = address.street.trim() && address.city.trim() && 
                        address.state.trim() && address.postalCode.trim() && 
                        address.country.trim();

    if (hasAllFields) {
      timeoutRef.current = setTimeout(() => {
        validateMutation.mutate(address);
      }, 1500); // Increased debounce time
    } else {
      // Clear validation if fields are incomplete
      setLastValidationResult(null);
    }
  }, [validateMutation.mutate]);

  const validateAddress = (address: AddressInput) => {
    // Immediate validation without debounce (for form submission)
    if (address.street.trim() && address.city.trim() && address.state.trim() && 
        address.postalCode.trim() && address.country.trim()) {
      validateMutation.mutate(address);
    } else {
      setLastValidationResult({
        isValid: false,
        errors: ["All address fields are required"],
        warnings: [],
        source: "local",
      });
    }
  };

  const clearValidation = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setLastValidationResult(null);
    setLastValidatedSnapshot("");
  }, []);

  // Check if address is valid for saving - must match the validated snapshot
  const isAddressValidForSaving = useCallback((currentAddress: AddressInput) => {
    if (!lastValidationResult?.isValid) {
      return false;
    }
    
    const currentSnapshot = JSON.stringify(currentAddress);
    return currentSnapshot === lastValidatedSnapshot;
  }, [lastValidationResult, lastValidatedSnapshot]);

  return {
    validateAddress, // Immediate validation for form submission
    validateAddressDebounced, // Debounced validation for real-time feedback
    clearValidation,
    isValidating: validateMutation.isPending,
    validationResult: lastValidationResult,
    hasValidationResult: lastValidationResult !== null,
    isAddressValidForSaving,
  };
}