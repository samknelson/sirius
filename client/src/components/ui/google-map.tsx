import { useEffect, useRef, useState } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

declare global {
  namespace google.maps {
    interface MapsLibrary {
      Map: typeof google.maps.Map;
    }
    interface MarkerLibrary {
      AdvancedMarkerElement: any;
    }
    class Map {
      constructor(element: HTMLElement, opts?: any);
    }
  }
}

interface GoogleMapProps {
  latitude: number;
  longitude: number;
  height?: string;
  zoom?: number;
  markerTitle?: string;
}

export function GoogleMap({ 
  latitude, 
  longitude, 
  height = "300px", 
  zoom = 15,
  markerTitle = "Location"
}: GoogleMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initializeMap = async () => {
      try {
        const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
        if (!apiKey) {
          setError("Google Maps API key not configured");
          return;
        }

        setOptions({
          key: apiKey,
          v: "weekly"
        });

        const { Map } = await importLibrary("maps") as google.maps.MapsLibrary;
        const { AdvancedMarkerElement } = await importLibrary("marker") as google.maps.MarkerLibrary;

        if (mapRef.current) {
          const position = { lat: latitude, lng: longitude };
          
          const map = new Map(mapRef.current, {
            center: position,
            zoom: zoom,
            mapId: "WORKER_ADDRESS_MAP"
          });

          new AdvancedMarkerElement({
            map,
            position,
            title: markerTitle
          });

          setIsLoaded(true);
        }
      } catch (err: any) {
        console.error("Error loading Google Maps:", err);
        setError("Failed to load map");
      }
    };

    initializeMap();
  }, [latitude, longitude, zoom, markerTitle]);

  if (error) {
    return (
      <div 
        className="bg-muted/30 rounded-lg flex items-center justify-center text-muted-foreground text-sm"
        style={{ height }}
        data-testid="map-error"
      >
        {error}
      </div>
    );
  }

  return (
    <div 
      ref={mapRef} 
      className="rounded-lg border border-border overflow-hidden"
      style={{ height }}
      data-testid="google-map"
    />
  );
}
