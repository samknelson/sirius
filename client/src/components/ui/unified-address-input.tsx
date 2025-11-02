import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle, AlertCircle, Edit, MapPin } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { ParseAddressRequest, ParseAddressResponse, StructuredAddress } from "@shared/schema";
import { insertPostalAddressSchema } from "@shared/schema";
import { useAddressValidationConfig } from "@/hooks/useAddressValidationConfig";

interface AddressFormData {
  friendlyName?: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isPrimary: boolean;
  isActive: boolean;
  validationResponse?: any; // JSON field to store full Google API response
}

interface UnifiedAddressInputProps {
  defaultValues?: Partial<AddressFormData>;
  onSubmit: (data: AddressFormData) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
}

export function UnifiedAddressInput({
  defaultValues,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel = "Save Address"
}: UnifiedAddressInputProps) {
  const { toast } = useToast();
  const { data: addressConfig } = useAddressValidationConfig();
  
  // Helper to get default country
  const getDefaultCountry = () => {
    const defaultCountry = addressConfig?.local.countries?.[0] || "US";
    return defaultCountry === "US" ? "United States" : defaultCountry;
  };
  const [rawAddress, setRawAddress] = useState("");
  const [parsedAddress, setParsedAddress] = useState<StructuredAddress | null>(null);
  const [parseResult, setParseResult] = useState<ParseAddressResponse | null>(null);
  const [showParsedView, setShowParsedView] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [confirmedFormState, setConfirmedFormState] = useState<AddressFormData | null>(null);
  const [persistedSnapshot, setPersistedSnapshot] = useState<AddressFormData | null>(null);

  const addressFormSchema = insertPostalAddressSchema.omit({ contactId: true });
  
  const form = useForm<AddressFormData>({
    resolver: zodResolver(addressFormSchema),
    defaultValues: {
      street: "",
      city: "",
      state: "",
      postalCode: "",
      country: "United States", // Will be updated by effect when config loads
      isPrimary: false,
      isActive: true,
      ...defaultValues,
    },
  });

  // Update form country when configuration loads
  useEffect(() => {
    if (addressConfig && !defaultValues?.country) {
      const defaultCountry = getDefaultCountry();
      form.setValue("country", defaultCountry);
    }
  }, [addressConfig]);

  // Initialize from default values when provided
  useEffect(() => {
    if (defaultValues) {
      const parts = [
        defaultValues.street,
        defaultValues.city,
        defaultValues.state,
        defaultValues.postalCode,
        defaultValues.country !== getDefaultCountry() ? defaultValues.country : null
      ].filter(Boolean);
      
      if (parts.length > 0) {
        setRawAddress(parts.join(", "));
        setShowParsedView(true);
        setParsedAddress({
          street: defaultValues.street || "",
          city: defaultValues.city || "",
          state: defaultValues.state || "",
          postalCode: defaultValues.postalCode || "",
          country: defaultValues.country || getDefaultCountry(),
        });
        
        // Set confirmed state snapshot for cancellation
        const confirmedState: AddressFormData = {
          friendlyName: defaultValues.friendlyName,
          street: defaultValues.street || "",
          city: defaultValues.city || "",
          state: defaultValues.state || "",
          postalCode: defaultValues.postalCode || "",
          country: defaultValues.country || getDefaultCountry(),
          isPrimary: defaultValues.isPrimary || false,
          isActive: defaultValues.isActive !== undefined ? defaultValues.isActive : true,
        };
        setConfirmedFormState(confirmedState);
        setPersistedSnapshot(confirmedState);
      }
    }
  }, [defaultValues]);

  const parseAddressMutation = useMutation({
    mutationFn: async (request: ParseAddressRequest): Promise<ParseAddressResponse> => {
      const response = await apiRequest("POST", "/api/addresses/parse", request);
      return response.json();
    },
    onSuccess: (response: ParseAddressResponse) => {
      setParseResult(response);
      
      if (response.success) {
        setParsedAddress(response.structuredAddress);
        setShowParsedView(true);
        
        // Update form with parsed data
        form.setValue("street", response.structuredAddress.street || "");
        form.setValue("city", response.structuredAddress.city || "");
        form.setValue("state", response.structuredAddress.state || "");
        form.setValue("postalCode", response.structuredAddress.postalCode || "");
        // Get default country from configuration
        const defaultCountry = addressConfig?.local.countries?.[0] || "US";
        const countryDisplayName = defaultCountry === "US" ? "United States" : defaultCountry;
        form.setValue("country", response.structuredAddress.country || countryDisplayName);
        
        // Update confirmed state snapshot
        const newConfirmedState = {
          street: response.structuredAddress.street || "",
          city: response.structuredAddress.city || "",
          state: response.structuredAddress.state || "",
          postalCode: response.structuredAddress.postalCode || "",
          country: response.structuredAddress.country || getDefaultCountry(),
          isPrimary: form.getValues("isPrimary"),
          isActive: form.getValues("isActive"),
        };
        setConfirmedFormState(newConfirmedState);
        setPersistedSnapshot(newConfirmedState);
        
        toast({
          title: "Address Parsed",
          description: `Address parsed successfully with ${Math.round((response.validation.confidence || 0) * 100)}% confidence.`,
        });
      } else {
        toast({
          title: "Parsing Failed",
          description: response.message || "Could not parse the address. Please try manual entry.",
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      console.error("Address parsing error:", error);
      toast({
        title: "Parsing Error",
        description: "Failed to parse address. Please try again or enter manually.",
        variant: "destructive",
      });
    },
  });

  const handleParseAddress = () => {
    if (!rawAddress.trim()) {
      toast({
        title: "Address Required",
        description: "Please enter an address to parse.",
        variant: "destructive",
      });
      return;
    }

    // Get default country from configuration, fallback to US
    const defaultCountry = addressConfig?.local.countries?.[0] || "US";
    const countryDisplayName = defaultCountry === "US" ? "United States" : defaultCountry;
    
    const parseRequest: ParseAddressRequest = {
      rawAddress: rawAddress.trim(),
      context: {
        country: countryDisplayName,
      },
    };

    parseAddressMutation.mutate(parseRequest);
  };

  const handleStartOver = () => {
    setRawAddress("");
    setParsedAddress(null);
    setParseResult(null);
    setShowParsedView(false);
    setIsEditing(false);
    
    // Get default country from configuration
    const defaultCountry = addressConfig?.local.countries?.[0] || "US";
    const countryDisplayName = defaultCountry === "US" ? "United States" : defaultCountry;
    
    form.reset({
      street: "",
      city: "",
      state: "",
      postalCode: "",
      country: countryDisplayName,
      isPrimary: false,
      isActive: true,
    });
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    const formValues = form.getValues();
    
    // Update parsed address
    setParsedAddress({
      street: formValues.street,
      city: formValues.city,
      state: formValues.state,
      postalCode: formValues.postalCode,
      country: formValues.country,
    });
    
    // Update confirmed state snapshot to include ALL form values
    setConfirmedFormState(formValues);
    setPersistedSnapshot(formValues);
    setIsEditing(false);
    
    toast({
      title: "Address Updated",
      description: "Address components have been updated.",
    });
  };

  const handleCancelEdit = () => {
    // Get default country from configuration
    const defaultCountry = addressConfig?.local.countries?.[0] || "US";
    const countryDisplayName = defaultCountry === "US" ? "United States" : defaultCountry;
    
    // Reset ALL form values to the persisted snapshot (not the potentially corrupted confirmed state)
    const stateToRestore = persistedSnapshot || {
      friendlyName: undefined,
      street: "",
      city: "",
      state: "",
      postalCode: "",
      country: countryDisplayName,
      isPrimary: false,
      isActive: true,
    };
    
    form.reset(stateToRestore);
    
    // Also restore the confirmed state to match the persisted snapshot
    setConfirmedFormState(stateToRestore);
    
    // Sync parsed address if we have one in the snapshot
    if (stateToRestore.street || stateToRestore.city) {
      setParsedAddress({
        street: stateToRestore.street,
        city: stateToRestore.city,
        state: stateToRestore.state,
        postalCode: stateToRestore.postalCode,
        country: stateToRestore.country,
      });
    }
    
    setIsEditing(false);
  };

  const handleFormSubmit = (data: AddressFormData) => {
    // Include the validation response if we have one from parsing
    const dataWithValidation = {
      ...data,
      validationResponse: parseResult?.success && parseResult.validation?.providerMetadata?.rawGoogleResponse 
        ? parseResult.validation.providerMetadata.rawGoogleResponse
        : undefined,
    };
    onSubmit(dataWithValidation);
  };

  const getConfidenceBadgeVariant = (confidence?: number) => {
    if (!confidence) return "secondary";
    if (confidence >= 0.8) return "default";
    if (confidence >= 0.6) return "secondary";
    return "destructive";
  };

  const getConfidenceLabel = (confidence?: number) => {
    if (!confidence) return "Unknown";
    const percent = Math.round(confidence * 100);
    if (percent >= 80) return `High (${percent}%)`;
    if (percent >= 60) return `Medium (${percent}%)`;
    return `Low (${percent}%)`;
  };

  if (!showParsedView) {
    // Raw address input phase
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <MapPin className="w-4 h-4" />
            Enter Address
          </label>
          <div className="flex gap-2">
            <Input
              placeholder="123 Main St, Anytown, CA 12345"
              value={rawAddress}
              onChange={(e) => setRawAddress(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleParseAddress();
                }
              }}
              data-testid="input-raw-address"
              className="flex-1"
            />
            <Button
              type="button"
              onClick={handleParseAddress}
              disabled={parseAddressMutation.isPending || !rawAddress.trim()}
              data-testid="button-parse-address"
            >
              {parseAddressMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Parsing...
                </>
              ) : (
                "Parse"
              )}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Enter your complete address and we'll parse it into components for you.
          </p>
        </div>

        {parseResult && !parseResult.success && (
          <Card className="border-destructive">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2 text-destructive">
                <AlertCircle className="w-4 h-4" />
                Parsing Failed
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground mb-3">
                {parseResult.message}
              </p>
              {parseResult.validation.errors && parseResult.validation.errors.length > 0 && (
                <ul className="text-sm text-destructive space-y-1 mb-3">
                  {parseResult.validation.errors.map((error, index) => (
                    <li key={index}>• {error}</li>
                  ))}
                </ul>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowParsedView(true);
                  setParsedAddress({
                    street: "",
                    city: "",
                    state: "",
                    postalCode: "",
                    country: getDefaultCountry(),
                  });
                  
                  // Set up manual entry mode but preserve the persisted snapshot
                  const currentPrimary = form.getValues("isPrimary");
                  const currentActive = form.getValues("isActive");
                  
                  // Initialize form for manual entry
                  form.reset({
                    street: "",
                    city: "",
                    state: "",
                    postalCode: "",
                    country: getDefaultCountry(),
                    isPrimary: currentPrimary,
                    isActive: currentActive,
                  });
                  
                  // Do NOT update persistedSnapshot - keep original values for cancellation
                  setIsEditing(true);
                }}
                data-testid="button-enter-manually"
              >
                Enter Address Manually
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="flex justify-end space-x-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // Parsed address view with confirmation/editing
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                Address Parsed
              </CardTitle>
              <div className="flex items-center gap-2">
                {parseResult?.validation && (
                  <Badge variant={getConfidenceBadgeVariant(parseResult.validation.confidence)}>
                    {getConfidenceLabel(parseResult.validation.confidence)}
                  </Badge>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleEdit}
                  data-testid="button-edit-address"
                >
                  <Edit className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <CardDescription>
              Review and confirm the parsed address components below.
              {parseResult?.validation.source && (
                <span className="ml-1">
                  (Parsed using {parseResult.validation.source})
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isEditing ? (
              // Editing mode
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="friendlyName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Friendly Name (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Home, Office, Warehouse" data-testid="input-friendly-name" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="street"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Street Address</FormLabel>
                      <FormControl>
                        <Input placeholder="123 Main St" data-testid="input-street" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <Input placeholder="New York" data-testid="input-city" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State</FormLabel>
                        <FormControl>
                          <Input placeholder="NY" data-testid="input-state" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="postalCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Postal Code</FormLabel>
                        <FormControl>
                          <Input placeholder="10001" data-testid="input-postal-code" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Country</FormLabel>
                        <FormControl>
                          <Input placeholder="United States" data-testid="input-country" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCancelEdit}
                    data-testid="button-cancel-edit"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveEdit}
                    data-testid="button-save-edit"
                  >
                    Save Changes
                  </Button>
                </div>
              </div>
            ) : (
              // Display mode
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Street</label>
                  <p className="text-sm text-muted-foreground" data-testid="text-street">
                    {parsedAddress?.street || "—"}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium">City</label>
                  <p className="text-sm text-muted-foreground" data-testid="text-city">
                    {parsedAddress?.city || "—"}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium">State</label>
                  <p className="text-sm text-muted-foreground" data-testid="text-state">
                    {parsedAddress?.state || "—"}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium">Postal Code</label>
                  <p className="text-sm text-muted-foreground" data-testid="text-postal-code">
                    {parsedAddress?.postalCode || "—"}
                  </p>
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium">Country</label>
                  <p className="text-sm text-muted-foreground" data-testid="text-country">
                    {parsedAddress?.country || "—"}
                  </p>
                </div>
              </div>
            )}

            {parseResult?.validation && (
              <div className="mt-4 p-3 bg-muted rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Validation Results</span>
                  <Badge variant={parseResult.validation.isValid ? "default" : "destructive"}>
                    {parseResult.validation.isValid ? "Valid" : "Issues Found"}
                  </Badge>
                </div>
                
                {parseResult.validation.warnings && parseResult.validation.warnings.length > 0 && (
                  <div className="mb-2">
                    <p className="text-sm font-medium text-orange-600 mb-1">Warnings:</p>
                    <ul className="text-sm text-orange-600 space-y-1">
                      {parseResult.validation.warnings.map((warning, index) => (
                        <li key={index}>• {warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
                
                {parseResult.validation.errors && parseResult.validation.errors.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-destructive mb-1">Errors:</p>
                    <ul className="text-sm text-destructive space-y-1">
                      {parseResult.validation.errors.map((error, index) => (
                        <li key={index}>• {error}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Common address metadata fields */}
        <div className="flex items-center justify-between">
          <FormField
            control={form.control}
            name="isPrimary"
            render={({ field }) => (
              <FormItem className="flex items-center space-x-2">
                <FormControl>
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={field.onChange}
                    data-testid="switch-is-primary"
                    className="rounded"
                  />
                </FormControl>
                <FormLabel>Primary address</FormLabel>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <FormItem className="flex items-center space-x-2">
                <FormControl>
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={field.onChange}
                    data-testid="switch-is-active"
                    className="rounded"
                  />
                </FormControl>
                <FormLabel>Active</FormLabel>
              </FormItem>
            )}
          />
        </div>

        <div className="flex justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={handleStartOver}
            data-testid="button-start-over"
          >
            Start Over
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              data-testid="button-save"
            >
              {isSubmitting ? "Saving..." : submitLabel}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
}