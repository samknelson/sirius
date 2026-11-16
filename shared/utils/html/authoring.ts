/** Authoring presets, not delivery-wide defaults or a stored-document migration. */
export const FUND_COLORS = [
  { name: "Red", hex: "#CC0D12" },
  { name: "Black", hex: "#000000" },
  { name: "Dark Grey", hex: "#241F21" },
  { name: "Light Grey", hex: "#ECEAEA" },
] as const;

export const AUTHORING_TYPOGRAPHY = {
  p: { size: "16px", weight: "400" },
  h1: { size: "28px", weight: "700" },
  h2: { size: "22px", weight: "700" },
  h3: { size: "18px", weight: "700" },
} as const;
