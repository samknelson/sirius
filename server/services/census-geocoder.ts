export interface CensusDistrictInfo {
  state: string;
  cd: string;
  sldu: string;
  sldl: string;
  districtKey: string;
}

interface CensusGeographyResult {
  GEOID?: string;
  BASENAME?: string;
  NAME?: string;
  STATE?: string;
  CD?: string;
  SLDU?: string;
  SLDL?: string;
  [key: string]: unknown;
}

interface CensusGeocoderResponse {
  result?: {
    geographies?: {
      [layerName: string]: CensusGeographyResult[];
    };
  };
}

export async function lookupDistricts(lat: number, lng: number): Promise<CensusDistrictInfo | null> {
  const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    console.warn(`Census Geocoder returned ${response.status} — skipping district cache`);
    return null;
  }

  const data: CensusGeocoderResponse = await response.json();

  const geos = data.result?.geographies;
  if (!geos) return null;

  let state = "";
  let cd = "";
  let sldu = "";
  let sldl = "";

  for (const [layerName, results] of Object.entries(geos)) {
    if (!results || results.length === 0) continue;
    const geo = results[0];

    if (geo.STATE && !state) {
      state = geo.STATE;
    }

    const lowerLayer = layerName.toLowerCase();

    if (lowerLayer.includes("congressional") && geo.CD) {
      cd = geo.CD;
    } else if (lowerLayer.includes("congressional") && geo.BASENAME) {
      cd = geo.BASENAME;
    }

    if ((lowerLayer.includes("state legislative") && lowerLayer.includes("upper")) || lowerLayer.includes("sldu")) {
      sldu = geo.SLDU || geo.BASENAME || "";
    }

    if ((lowerLayer.includes("state legislative") && lowerLayer.includes("lower")) || lowerLayer.includes("sldl")) {
      sldl = geo.SLDL || geo.BASENAME || "";
    }
  }

  if (!state || (!cd && !sldu && !sldl)) {
    return null;
  }

  const districtKey = `${state}|${cd}|${sldu}|${sldl}`;

  return { state, cd, sldu, sldl, districtKey };
}
