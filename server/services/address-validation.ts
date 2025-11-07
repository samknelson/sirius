import { storage } from "../storage";
import { 
  ParseAddressRequest, 
  ParseAddressResponse, 
  StructuredAddress,
  AddressParseValidation 
} from "@shared/schema";

// Address validation configuration interface
export interface AddressValidationConfig {
  mode: "local" | "google";
  local: {
    enabled: boolean;
    countries: string[];
    strictValidation: boolean;
  };
  google: {
    enabled: boolean;
    apiKeyName: string;
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

// Default configuration
const DEFAULT_CONFIG: AddressValidationConfig = {
  mode: "local",
  local: {
    enabled: true,
    countries: ["US"],
    strictValidation: true,
  },
  google: {
    enabled: false,
    apiKeyName: "GOOGLE_MAPS_API_KEY",
    components: {
      country: true,
      administrative_area_level_1: true,
      postal_code: true,
    },
  },
  fallback: {
    useLocalOnGoogleFailure: true,
    logValidationAttempts: true,
  },
};

// US States validation data
const US_STATES = {
  "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
  "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
  "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
  "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
  "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri",
  "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
  "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
  "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
  "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
  "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
  "DC": "District of Columbia"
};

// Address validation result interface
export interface AddressValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  source: "local" | "google";
}

// Address input interface
export interface AddressInput {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

class AddressValidationService {
  private config: AddressValidationConfig | null = null;

  async getConfig(): Promise<AddressValidationConfig> {
    if (!this.config) {
      await this.loadConfig();
    }
    return this.config!;
  }

  private async loadConfig(): Promise<void> {
    try {
      const configVar = await storage.variables.getVariableByName("address_validation_config");
      if (configVar) {
        this.config = configVar.value as AddressValidationConfig;
      } else {
        // Create default configuration if it doesn't exist
        await this.initializeConfig();
      }
    } catch (error) {
      console.error("Failed to load address validation config:", error);
      this.config = DEFAULT_CONFIG;
    }
  }

  private async initializeConfig(): Promise<void> {
    try {
      await storage.variables.createVariable({
        name: "address_validation_config",
        value: DEFAULT_CONFIG,
      });
      this.config = DEFAULT_CONFIG;
      console.log("Address validation configuration initialized with default settings");
    } catch (error) {
      console.error("Failed to initialize address validation config:", error);
      this.config = DEFAULT_CONFIG;
    }
  }

  async validateAddress(address: AddressInput): Promise<AddressValidationResult> {
    const config = await this.getConfig();

    if (config.mode === "google" && config.google.enabled) {
      try {
        return await this.validateWithGoogle(address);
      } catch (error) {
        console.error("Google validation failed:", error);
        if (config.fallback.useLocalOnGoogleFailure) {
          console.log("Falling back to local validation");
          return await this.validateLocally(address);
        }
        return {
          isValid: false,
          errors: ["Address validation service temporarily unavailable"],
          warnings: [],
          source: "google",
        };
      }
    }

    return await this.validateLocally(address);
  }

  private async validateLocally(address: AddressInput): Promise<AddressValidationResult> {
    const config = await this.getConfig();
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: any = {};

    // Validate country - normalize country names to codes
    const normalizeCountry = (country: string): string => {
      const normalized = country.toUpperCase();
      if (normalized === "UNITED STATES" || normalized === "USA") return "US";
      if (normalized === "CANADA") return "CA";
      return normalized;
    };

    const countryCode = normalizeCountry(address.country);
    if (!config.local.countries.includes(countryCode)) {
      if (config.local.strictValidation) {
        errors.push(`Country "${address.country}" is not supported for validation`);
      } else {
        warnings.push(`Country "${address.country}" validation not available`);
      }
    }

    // US-specific validation
    if (countryCode === "US") {
      // Validate state
      const stateCode = address.state.toUpperCase();
      if (!US_STATES[stateCode as keyof typeof US_STATES]) {
        errors.push("Invalid state code. Please use 2-letter state abbreviation (e.g., CA, NY, TX)");
      } else {
        // Suggest full state name if abbreviation is correct
        suggestions.state = US_STATES[stateCode as keyof typeof US_STATES];
      }

      // Validate postal code
      const zipRegex = /^\d{5}(-\d{4})?$/;
      if (!zipRegex.test(address.postalCode)) {
        errors.push("Invalid postal code format. Use 5 digits (12345) or 9 digits (12345-6789)");
      } else {
        // Normalize to 5-digit format if needed
        const normalizedZip = address.postalCode.split("-")[0];
        if (normalizedZip !== address.postalCode) {
          suggestions.postalCode = normalizedZip;
        }
      }
    }

    // Basic field validation
    if (!address.street.trim()) {
      errors.push("Street address is required");
    }
    if (!address.city.trim()) {
      errors.push("City is required");
    }
    if (!address.state.trim()) {
      errors.push("State is required");
    }
    if (!address.postalCode.trim()) {
      errors.push("Postal code is required");
    }
    if (!address.country.trim()) {
      errors.push("Country is required");
    }

    // Street address basic validation
    if (address.street.trim() && !/\d/.test(address.street)) {
      warnings.push("Street address typically includes a number");
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestions: Object.keys(suggestions).length > 0 ? suggestions : undefined,
      source: "local",
    };
  }

  private async validateWithGoogle(address: AddressInput): Promise<AddressValidationResult> {
    const config = await this.getConfig();
    const apiKey = process.env[config.google.apiKeyName];
    
    if (!apiKey) {
      throw new Error(`Google Maps API key not found in environment variable: ${config.google.apiKeyName}`);
    }

    try {
      // Construct address string for Google validation
      const addressString = [
        address.street,
        address.city,
        address.state,
        address.postalCode,
        address.country
      ].filter(Boolean).join(", ");

      // Use Google Places API to validate the address
      const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressString)}&key=${apiKey}`;
      
      const response = await fetch(geocodeUrl);
      const data = await response.json();

      if (data.status !== 'OK' || !data.results || data.results.length === 0) {
        return {
          isValid: false,
          errors: [`Google validation failed: ${data.status} - ${data.error_message || 'No results found'}`],
          warnings: [],
          source: "google",
        };
      }

      const result = data.results[0];
      const addressComponents = result.address_components || [];
      
      // Parse Google's response and compare with input
      const googleStructured = this.parseGoogleAddressComponents(addressComponents, result);
      
      // Compare input address with Google's normalized version
      const errors: string[] = [];
      const warnings: string[] = [];
      const suggestions: any = {};

      // Validate street number/name
      if (address.street && googleStructured.street) {
        const inputStreetNormalized = address.street.toLowerCase().replace(/\s+/g, ' ').trim();
        const googleStreetNormalized = googleStructured.street.toLowerCase().replace(/\s+/g, ' ').trim();
        
        if (inputStreetNormalized !== googleStreetNormalized) {
          warnings.push("Street address may not match Google's records");
          suggestions.street = googleStructured.street;
        }
      }

      // Validate city
      if (address.city && googleStructured.city) {
        const inputCityNormalized = address.city.toLowerCase().trim();
        const googleCityNormalized = googleStructured.city.toLowerCase().trim();
        
        if (inputCityNormalized !== googleCityNormalized) {
          warnings.push("City name may not match official records");
          suggestions.city = googleStructured.city;
        }
      }

      // Validate state
      if (address.state && googleStructured.state) {
        const inputStateNormalized = address.state.toLowerCase().trim();
        const googleStateNormalized = googleStructured.state.toLowerCase().trim();
        
        if (inputStateNormalized !== googleStateNormalized) {
          warnings.push("State may not match official records");
          suggestions.state = googleStructured.state;
        }
      }

      // Validate postal code
      if (address.postalCode && googleStructured.postalCode) {
        const inputZipNormalized = address.postalCode.replace(/\D/g, '');
        const googleZipNormalized = googleStructured.postalCode.replace(/\D/g, '');
        
        if (inputZipNormalized !== googleZipNormalized) {
          warnings.push("Postal code may not match for this address");
          suggestions.postalCode = googleStructured.postalCode;
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        suggestions: Object.keys(suggestions).length > 0 ? suggestions : undefined,
        source: "google",
      };

    } catch (error) {
      throw new Error(`Google validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async parseAndValidate(request: ParseAddressRequest): Promise<ParseAddressResponse> {
    const config = await this.getConfig();
    
    try {
      let structuredAddress: StructuredAddress;
      let validation: AddressParseValidation;

      if (config.mode === "google" && config.google.enabled) {
        try {
          const parseResult = await this.parseWithGoogle(request.rawAddress, request.context);
          structuredAddress = parseResult.structuredAddress;
          validation = parseResult.validation;
        } catch (error) {
          console.error("Google parsing failed:", error);
          if (config.fallback.useLocalOnGoogleFailure) {
            console.log("Falling back to local parsing");
            const parseResult = await this.parseWithLocal(request.rawAddress, request.context);
            structuredAddress = parseResult.structuredAddress;
            validation = parseResult.validation;
          } else {
            return {
              success: false,
              validation: {
                isValid: false,
                errors: ["Address parsing service temporarily unavailable"],
                warnings: [],
                source: "google",
              },
              message: "Google parsing failed and fallback is disabled",
            };
          }
        }
      } else {
        const parseResult = await this.parseWithLocal(request.rawAddress, request.context);
        structuredAddress = parseResult.structuredAddress;
        validation = parseResult.validation;
      }

      if (validation.isValid) {
        return {
          success: true,
          structuredAddress,
          validation,
        };
      } else {
        return {
          success: false,
          validation,
          message: "Address could not be parsed or validated",
        };
      }
    } catch (error) {
      console.error("Address parsing error:", error);
      return {
        success: false,
        validation: {
          isValid: false,
          errors: ["Unexpected error during address parsing"],
          warnings: [],
          source: config.mode,
        },
        message: "Internal parsing error",
      };
    }
  }

  private async parseWithLocal(rawAddress: string, context?: ParseAddressRequest['context']): Promise<{
    structuredAddress: StructuredAddress;
    validation: AddressParseValidation;
  }> {
    // Parse the raw address string using local heuristics
    const structuredAddress = this.parseAddressStringLocally(rawAddress, context);
    
    // Validate the parsed address using existing validation logic
    const validationResult = await this.validateLocally({
      street: structuredAddress.street || "",
      city: structuredAddress.city || "",
      state: structuredAddress.state || "",
      postalCode: structuredAddress.postalCode || "",
      country: structuredAddress.country || context?.country || "United States",
    });

    const validation: AddressParseValidation = {
      isValid: validationResult.isValid,
      errors: validationResult.errors,
      warnings: validationResult.warnings,
      source: "local",
      confidence: this.calculateLocalConfidence(structuredAddress),
      suggestions: validationResult.suggestions 
        ? Object.entries(validationResult.suggestions).map(([field, value]) => ({
            field,
            value: String(value),
          }))
        : undefined,
    };

    return { structuredAddress, validation };
  }

  private async parseWithGoogle(rawAddress: string, context?: ParseAddressRequest['context']): Promise<{
    structuredAddress: StructuredAddress;
    validation: AddressParseValidation;
  }> {
    const config = await this.getConfig();
    const apiKey = process.env[config.google.apiKeyName];
    
    if (!apiKey) {
      throw new Error(`Google Maps API key not found in environment variable: ${config.google.apiKeyName}`);
    }

    try {
      // Use Google Places API to geocode the address
      const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(rawAddress)}&key=${apiKey}`;
      
      const response = await fetch(geocodeUrl);
      const data = await response.json();

      if (data.status !== 'OK' || !data.results || data.results.length === 0) {
        throw new Error(`Google geocoding failed: ${data.status} - ${data.error_message || 'No results found'}`);
      }

      const result = data.results[0];
      const addressComponents = result.address_components || [];
      
      // Parse address components into our structured format
      const structuredAddress = this.parseGoogleAddressComponents(addressComponents, result);
      
      // Calculate confidence based on Google's result quality
      const confidence = this.calculateGoogleConfidence(result, structuredAddress);
      
      // Validate the parsed address using our validation logic
      const validationResult = await this.validateLocally({
        street: structuredAddress.street || "",
        city: structuredAddress.city || "",
        state: structuredAddress.state || "",
        postalCode: structuredAddress.postalCode || "",
        country: structuredAddress.country || "United States",
      });

      const validation: AddressParseValidation = {
        isValid: validationResult.isValid,
        errors: validationResult.errors,
        warnings: validationResult.warnings,
        source: "google",
        confidence,
        suggestions: validationResult.suggestions 
          ? Object.entries(validationResult.suggestions).map(([field, value]) => ({
              field,
              value: String(value),
            }))
          : undefined,
        providerMetadata: {
          formattedAddress: result.formatted_address,
          placeId: result.place_id,
          types: result.types,
          geometry: {
            location: result.geometry?.location,
            locationType: result.geometry?.location_type,
          },
          // Store the full Google API response for database persistence
          rawGoogleResponse: result,
        },
      };

      return { structuredAddress, validation };
    } catch (error) {
      console.error("Google Places parsing error:", error);
      throw error;
    }
  }

  private parseGoogleAddressComponents(components: any[], result: any): StructuredAddress {
    const getComponent = (types: string[]) => {
      const component = components.find((comp: any) => 
        types.some(type => comp.types.includes(type))
      );
      return component?.long_name || "";
    };

    const getShortComponent = (types: string[]) => {
      const component = components.find((comp: any) => 
        types.some(type => comp.types.includes(type))
      );
      return component?.short_name || "";
    };

    const streetNumber = getComponent(["street_number"]);
    const streetName = getComponent(["route"]);
    const street = streetNumber && streetName ? `${streetNumber} ${streetName}` : streetName || streetNumber;

    return {
      street: street || "",
      city: getComponent(["locality", "sublocality", "administrative_area_level_3"]) || "",
      state: getShortComponent(["administrative_area_level_1"]) || "",
      postalCode: getComponent(["postal_code"]) || "",
      country: getComponent(["country"]) || "",
      sublocality: getComponent(["sublocality"]) || undefined,
      province: getComponent(["administrative_area_level_1"]) || undefined,
      locality: getComponent(["locality"]) || undefined,
    };
  }

  private calculateGoogleConfidence(result: any, structured: StructuredAddress): number {
    let confidence = 0.7; // Base confidence for Google results
    
    // Boost confidence based on location type
    const locationType = result.geometry?.location_type;
    switch (locationType) {
      case 'ROOFTOP':
        confidence += 0.3;
        break;
      case 'RANGE_INTERPOLATED':
        confidence += 0.2;
        break;
      case 'GEOMETRIC_CENTER':
        confidence += 0.1;
        break;
      case 'APPROXIMATE':
        confidence += 0.05;
        break;
    }

    // Adjust based on completeness of parsed components
    const requiredFields = ['street', 'city', 'state', 'postalCode'];
    const presentFields = requiredFields.filter(field => 
      structured[field as keyof StructuredAddress]?.trim()
    ).length;
    
    confidence *= (presentFields / requiredFields.length);
    
    // Boost if we have additional useful data
    if (result.place_id) confidence += 0.05;
    if (result.types?.includes('street_address')) confidence += 0.1;
    
    return Math.min(confidence, 1.0);
  }

  private parseAddressStringLocally(rawAddress: string, context?: ParseAddressRequest['context']): StructuredAddress {
    // Enhanced heuristic parsing for various address formats
    const trimmed = rawAddress.trim();
    const parts = trimmed.split(',').map(part => part.trim()).filter(part => part.length > 0);
    
    const result: StructuredAddress = {};

    if (parts.length === 0) {
      return result;
    }

    // Common country names to strip from the end
    const commonCountries = ['USA', 'US', 'UNITED STATES', 'AMERICA'];
    
    // Work backwards from the last part to identify components
    let workingParts = [...parts];
    
    // Check if last part is a country and strip it
    const lastPart = workingParts[workingParts.length - 1]?.toUpperCase();
    if (lastPart && commonCountries.includes(lastPart)) {
      result.country = this.normalizeCountryName(lastPart);
      workingParts.pop();
    } else {
      result.country = context?.country || "United States";
    }

    if (workingParts.length === 0) {
      return result;
    }

    // Extract street address (always the first part)
    result.street = workingParts[0];

    if (workingParts.length === 1) {
      // Only street provided, try to extract postal code from it
      const zipMatch = workingParts[0].match(/(\d{5}(-\d{4})?)$/);
      if (zipMatch) {
        result.postalCode = zipMatch[1];
        result.street = workingParts[0].replace(/\s*\d{5}(-\d{4})?$/, '').trim();
      }
      return result;
    }

    // For multiple parts, work backwards from the end
    // Last part should contain state and/or postal code
    const stateZipPart = workingParts[workingParts.length - 1];
    const parsedStateZip = this.parseStateAndZip(stateZipPart);
    
    if (parsedStateZip.state) {
      result.state = parsedStateZip.state;
    }
    if (parsedStateZip.postalCode) {
      result.postalCode = parsedStateZip.postalCode;
    }

    // Handle city extraction based on number of parts
    if (workingParts.length >= 3) {
      // Everything between street and state/zip is city
      const cityParts = workingParts.slice(1, -1);
      result.city = cityParts.join(', ');
    } else if (workingParts.length === 2) {
      // Handle "Street, City State ZIP" format - need to extract city from combined string
      const secondPart = workingParts[1];
      const cityStateZip = this.extractCityFromCombinedString(secondPart);
      
      if (cityStateZip.city) {
        result.city = cityStateZip.city;
      }
      
      // Re-parse state and ZIP from the extracted remainder
      if (cityStateZip.stateZipPart) {
        const parsedStateZip = this.parseStateAndZip(cityStateZip.stateZipPart);
        if (parsedStateZip.state) {
          result.state = parsedStateZip.state;
        }
        if (parsedStateZip.postalCode) {
          result.postalCode = parsedStateZip.postalCode;
        }
      }
    }

    return result;
  }

  private parseStateAndZip(stateZipString: string): { state?: string; postalCode?: string } {
    const result: { state?: string; postalCode?: string } = {};
    
    // Try different patterns for state and ZIP
    const patterns = [
      // "CA 94105" or "CA 94105-1234"
      /^([A-Z]{2})\s+(\d{5}(-\d{4})?)$/i,
      // "California 94105"
      /^([A-Za-z\s]+)\s+(\d{5}(-\d{4})?)$/,
      // Just state "CA" or "California"
      /^([A-Z]{2})$/i,
      /^([A-Za-z\s]+)$/,
    ];

    for (const pattern of patterns) {
      const match = stateZipString.match(pattern);
      if (match) {
        const stateCandidate = match[1].trim().toUpperCase();
        
        // Check if it's a valid 2-letter state code
        if (stateCandidate.length === 2 && US_STATES[stateCandidate as keyof typeof US_STATES]) {
          result.state = stateCandidate;
        } else {
          // Check if it's a full state name
          const stateCode = this.findStateCodeByName(stateCandidate);
          if (stateCode) {
            result.state = stateCode;
          }
        }
        
        if (match[2]) {
          result.postalCode = match[2];
        }
        break;
      }
    }

    // Also try to extract just ZIP if no state found
    if (!result.postalCode) {
      const zipMatch = stateZipString.match(/(\d{5}(-\d{4})?)/);
      if (zipMatch) {
        result.postalCode = zipMatch[1];
      }
    }

    return result;
  }

  private extractCityFromCombinedString(cityStateZip: string): { city?: string; stateZipPart?: string } {
    const trimmed = cityStateZip.trim();
    
    // Try to match patterns where state/zip are at the end
    const patterns = [
      // "San Francisco CA 94105" or "San Francisco CA 94105-1234"
      /^(.+?)\s+([A-Z]{2})\s+(\d{5}(-\d{4})?)$/i,
      // "San Francisco California 94105"
      /^(.+?)\s+([A-Za-z\s]+)\s+(\d{5}(-\d{4})?)$/,
      // "San Francisco CA" (no ZIP)
      /^(.+?)\s+([A-Z]{2})$/i,
      // "San Francisco California" (no ZIP)
      /^(.+?)\s+([A-Za-z\s]+)$/,
    ];

    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match) {
        const cityCandidate = match[1].trim();
        const stateCandidate = match[2].trim().toUpperCase();
        
        // Verify the state candidate is actually a state
        const isValidState = (stateCandidate.length === 2 && US_STATES[stateCandidate as keyof typeof US_STATES]) ||
                           this.findStateCodeByName(stateCandidate);
        
        if (isValidState) {
          const stateZipPart = match[3] ? `${match[2]} ${match[3]}` : match[2];
          return {
            city: cityCandidate,
            stateZipPart: stateZipPart,
          };
        }
      }
    }

    // If no state pattern found, try to extract just ZIP and treat rest as city
    const zipOnlyMatch = trimmed.match(/^(.+?)\s+(\d{5}(-\d{4})?)$/);
    if (zipOnlyMatch) {
      return {
        city: zipOnlyMatch[1].trim(),
        stateZipPart: zipOnlyMatch[2],
      };
    }

    // Fallback: treat entire string as city
    return {
      city: trimmed,
    };
  }

  private findStateCodeByName(stateName: string): string | undefined {
    const normalizedName = stateName.toUpperCase();
    for (const [code, name] of Object.entries(US_STATES)) {
      if (name.toUpperCase() === normalizedName) {
        return code;
      }
    }
    return undefined;
  }

  private normalizeCountryName(country: string): string {
    const normalized = country.toUpperCase();
    switch (normalized) {
      case 'USA':
      case 'US':
      case 'UNITED STATES':
      case 'AMERICA':
        return 'United States';
      default:
        return country;
    }
  }

  private calculateLocalConfidence(structured: StructuredAddress): number {
    const requiredFields = ['street', 'city', 'state', 'postalCode'];
    const optionalFields = ['country'];
    
    let score = 0;
    let requiredFieldsPresent = 0;
    
    // Check required fields (80% of confidence)
    for (const field of requiredFields) {
      if (structured[field as keyof StructuredAddress]?.trim()) {
        requiredFieldsPresent++;
      }
    }
    
    // Required fields contribute 80% of confidence
    score += (requiredFieldsPresent / requiredFields.length) * 0.8;
    
    // Optional fields contribute 20% of confidence
    for (const field of optionalFields) {
      if (structured[field as keyof StructuredAddress]?.trim()) {
        score += 0.2;
      }
    }
    
    // Heavily penalize missing critical fields
    if (requiredFieldsPresent < 2) {
      score *= 0.3; // Reduce confidence significantly if less than half required fields
    }
    
    return Math.min(score, 1.0);
  }

  async updateConfig(newConfig: Partial<AddressValidationConfig>): Promise<void> {
    const currentConfig = await this.getConfig();
    const updatedConfig = { ...currentConfig, ...newConfig };
    
    const configVar = await storage.variables.getVariableByName("address_validation_config");
    if (configVar) {
      await storage.variables.updateVariable(configVar.id, {
        value: updatedConfig,
      });
    } else {
      await storage.variables.createVariable({
        name: "address_validation_config",
        value: updatedConfig,
      });
    }
    
    this.config = updatedConfig;
  }

  async geocodeAddress(address: AddressInput): Promise<{
    success: boolean;
    latitude?: number;
    longitude?: number;
    accuracy?: string;
    validationResponse?: any;
    error?: string;
  }> {
    const config = await this.getConfig();
    const apiKey = process.env[config.google.apiKeyName];
    
    if (!apiKey) {
      return {
        success: false,
        error: "Google Maps API key not configured",
      };
    }

    try {
      const addressString = [
        address.street,
        address.city,
        address.state,
        address.postalCode,
        address.country
      ].filter(Boolean).join(", ");

      if (!addressString.trim()) {
        return {
          success: false,
          error: "Address cannot be empty",
        };
      }

      const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressString)}&key=${apiKey}`;
      
      const response = await fetch(geocodeUrl);
      const data = await response.json();

      if (data.status !== 'OK' || !data.results || data.results.length === 0) {
        return {
          success: false,
          error: `Geocoding failed: ${data.status}`,
        };
      }

      const result = data.results[0];
      const geometry = result.geometry;

      return {
        success: true,
        latitude: geometry?.location?.lat,
        longitude: geometry?.location?.lng,
        accuracy: geometry?.location_type,
        validationResponse: result,
      };

    } catch (error) {
      console.error("Geocoding error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

export const addressValidationService = new AddressValidationService();