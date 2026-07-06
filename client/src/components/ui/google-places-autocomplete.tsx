import { useEffect, useRef, useState } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

declare global {
  namespace google.maps {
    interface PlacesLibrary {
      Autocomplete: typeof google.maps.places.Autocomplete;
    }
    namespace places {
      class Autocomplete {
        constructor(input: HTMLInputElement, opts?: google.maps.places.AutocompleteOptions);
        addListener(eventName: string, handler: () => void): void;
        getPlace(): google.maps.places.PlaceResult;
      }
      interface AutocompleteOptions {
        types?: string[];
        fields?: string[];
      }
      interface PlaceResult {
        address_components?: google.maps.GeocoderAddressComponent[];
        formatted_address?: string;
        geometry?: any;
      }
    }
    interface GeocoderAddressComponent {
      long_name: string;
      short_name: string;
      types: string[];
    }
    namespace event {
      function clearInstanceListeners(instance: any): void;
    }
  }
  interface Window {
    google?: typeof google;
  }
}

interface GooglePlacesAutocompleteProps {
  onPlaceSelected: (place: google.maps.places.PlaceResult) => void;
  placeholder?: string;
  label?: string;
  value?: string;
  className?: string;
  testId?: string;
}

export function GooglePlacesAutocomplete({ 
  onPlaceSelected, 
  placeholder = "Start typing an address...", 
  label,
  value = "",
  className = "",
  testId = "input-places-autocomplete"
}: GooglePlacesAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [inputValue, setInputValue] = useState(value);

  useEffect(() => {
    const initializeGoogleMaps = async () => {
      try {
        // Set options for the Google Maps API
        setOptions({
          key: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "",
          v: "weekly"
        });

        // Import the Places library
        const { Autocomplete } = await importLibrary("places") as google.maps.PlacesLibrary;

        if (inputRef.current && !autocompleteRef.current) {
          autocompleteRef.current = new Autocomplete(inputRef.current, {
            types: ["address"],
            fields: ["address_components", "formatted_address", "geometry"]
          });

          autocompleteRef.current.addListener("place_changed", () => {
            const place = autocompleteRef.current?.getPlace();
            if (place && place.address_components) {
              onPlaceSelected(place);
              setInputValue(place.formatted_address || "");
            }
          });

          setIsLoaded(true);
        }
      } catch (error: any) {
        console.error("Error loading Google Maps API:", error);
      }
    };

    initializeGoogleMaps();

    return () => {
      if (autocompleteRef.current && window.google?.maps?.event) {
        window.google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, [onPlaceSelected]);

  // Update input value when prop changes
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}
      <Input
        ref={inputRef}
        type="text"
        placeholder={isLoaded ? placeholder : "Loading Google Maps..."}
        value={inputValue}
        onChange={handleInputChange}
        disabled={!isLoaded}
        className={className}
        data-testid={testId}
      />
    </div>
  );
}

export interface ParsedAddress {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export function parseGooglePlace(place: google.maps.places.PlaceResult): ParsedAddress {
  const components = place.address_components || [];
  
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
    city: getComponent(["locality", "sublocality"]) || "",
    state: getShortComponent(["administrative_area_level_1"]) || "",
    postalCode: getComponent(["postal_code"]) || "",
    country: getComponent(["country"]) || ""
  };
}