import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { GooglePlacesAutocomplete, parseGooglePlace, ParsedAddress } from "./google-places-autocomplete";
import { AddressValidationDisplay } from "./address-validation";
import { useAddressValidation } from "@/hooks/useAddressValidation";
import { useAddressValidationConfig } from "@/hooks/useAddressValidationConfig";
import { insertContactPostalSchema } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";

interface AddressFormData {
  street: string;
  street2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isPrimary: boolean;
  isActive: boolean;
}

interface ConditionalAddressFormProps {
  defaultValues?: Partial<AddressFormData>;
  onSubmit: (data: AddressFormData) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
}

export function ConditionalAddressForm({
  defaultValues,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel = "Save Address"
}: ConditionalAddressFormProps) {
  const { toast } = useToast();
  const { data: config, isLoading: configLoading } = useAddressValidationConfig();
  const validation = useAddressValidation();
  
  const addressFormSchema = insertContactPostalSchema.omit({ contactId: true });
  
  const form = useForm<AddressFormData>({
    resolver: zodResolver(addressFormSchema),
    defaultValues: {
      street: "",
      street2: "",
      city: "",
      state: "",
      postalCode: "",
      country: "United States",
      isPrimary: false,
      isActive: true,
      ...defaultValues,
    },
  });

  const formValues = form.watch();
  const [isGoogleMode, setIsGoogleMode] = useState(false);
  const [hasSelectedPlace, setHasSelectedPlace] = useState(false);

  // Determine validation mode based on config
  useEffect(() => {
    if (config) {
      setIsGoogleMode(config.mode === "google" && config.google.enabled);
    }
  }, [config]);

  // Only validate when user stops typing (not on every keystroke)
  useEffect(() => {
    if (!isGoogleMode && !hasSelectedPlace) {
      // Only validate if all required fields have some content
      const hasContent = formValues.street?.trim() && formValues.city?.trim() && 
                        formValues.state?.trim() && formValues.postalCode?.trim();
      if (hasContent) {
        validation.validateAddressDebounced(formValues);
      }
    }
  }, [formValues, validation.validateAddressDebounced, isGoogleMode, hasSelectedPlace]);

  const handleGooglePlaceSelected = (place: google.maps.places.PlaceResult) => {
    const parsed = parseGooglePlace(place);
    
    // Update all form fields with parsed data
    form.setValue("street", parsed.street);
    form.setValue("street2", parsed.street2 || form.getValues("street2") || "");
    form.setValue("city", parsed.city);
    form.setValue("state", parsed.state);
    form.setValue("postalCode", parsed.postalCode);
    form.setValue("country", parsed.country);
    
    setHasSelectedPlace(true);
    
    // Clear any validation state since Google has provided canonical data
    validation.clearValidation();
    
    toast({
      title: "Address Selected",
      description: "Address has been populated from Google Places.",
    });
  };

  const handleFormSubmit = (data: AddressFormData) => {
    // For Google mode, ensure user has selected a place
    if (isGoogleMode && !hasSelectedPlace && !validation.hasValidationResult) {
      toast({
        title: "Select Address",
        description: "Please select an address from the autocomplete suggestions.",
        variant: "destructive",
      });
      return;
    }

    // For local mode, check validation
    if (!isGoogleMode) {
      if (validation.isValidating) {
        toast({
          title: "Validation in Progress",
          description: "Please wait while we validate the address...",
        });
        return;
      }

      if (!validation.isAddressValidForSaving(data)) {
        if (validation.hasValidationResult) {
          toast({
            title: "Invalid Address",
            description: "Please fix the address validation errors before saving.",
            variant: "destructive",
          });
        } else {
          validation.validateAddress(data);
          toast({
            title: "Validating Address",
            description: "Please wait while we validate the address...",
          });
        }
        return;
      }
    }

    onSubmit(data);
  };

  const handleApplySuggestion = (field: string, value: string) => {
    form.setValue(field as keyof AddressFormData, value);
  };

  // Reset hasSelectedPlace when switching modes or when form is reset
  useEffect(() => {
    setHasSelectedPlace(false);
  }, [isGoogleMode, defaultValues]);

  if (configLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-4">
        {isGoogleMode ? (
          // Google Places Autocomplete Mode
          <div className="space-y-4">
            <GooglePlacesAutocomplete
              onPlaceSelected={handleGooglePlaceSelected}
              label="Address"
              placeholder="Start typing an address..."
              value={`${formValues.street} ${formValues.city} ${formValues.state} ${formValues.postalCode}`.trim()}
              testId="input-google-places"
            />
            
            {/* Show individual fields as read-only after selection */}
            {hasSelectedPlace && (
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
                <div>
                  <label className="text-sm font-medium">Address Line 1</label>
                  <p className="text-sm text-muted-foreground">{formValues.street}</p>
                </div>
                <div>
                  <label className="text-sm font-medium">City</label>
                  <p className="text-sm text-muted-foreground">{formValues.city}</p>
                </div>
                <div>
                  <label className="text-sm font-medium">State</label>
                  <p className="text-sm text-muted-foreground">{formValues.state}</p>
                </div>
                <div>
                  <label className="text-sm font-medium">Postal Code</label>
                  <p className="text-sm text-muted-foreground">{formValues.postalCode}</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          // Local Validation Mode
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="street"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address Line 1</FormLabel>
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

            {/* Address Validation Display for Local Mode */}
            <AddressValidationDisplay
              validationResult={validation.validationResult}
              isValidating={validation.isValidating}
              onApplySuggestion={handleApplySuggestion}
              className="my-4"
            />
          </div>
        )}
        
        {/* Common fields for both modes */}
        <FormField control={form.control} name="street2" render={({ field }) => (
          <FormItem>
            <FormLabel>Address Line 2</FormLabel>
            <FormControl><Input placeholder="Apartment, suite, or unit (optional)" data-testid="input-street2" {...field} value={field.value || ""} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <div className="flex items-center justify-between">
          <FormField
            control={form.control}
            name="isPrimary"
            render={({ field }) => (
              <FormItem className="flex items-center space-x-2">
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="switch-is-primary"
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
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="switch-is-active"
                  />
                </FormControl>
                <FormLabel>Active</FormLabel>
              </FormItem>
            )}
          />
        </div>
        
        <div className="flex justify-end space-x-2">
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
            disabled={isSubmitting || (isGoogleMode && !hasSelectedPlace && !validation.hasValidationResult)}
            data-testid="button-save"
          >
            {isSubmitting ? "Saving..." : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}