import { FUND_COLORS } from "@shared/utils/html/authoring";

export function FundColorSwatches({ label, onChange, disabled = false }: {
  label: string; onChange: (color: string) => void; disabled?: boolean;
}) {
  return <div role="group" aria-label={`${label} Fund colors`} className="flex flex-wrap gap-1.5">
    {FUND_COLORS.map(({ name, hex }) => <button key={hex} type="button" disabled={disabled}
      aria-label={`${label} ${name} ${hex}`} title={`${name} ${hex}`}
      className="h-7 w-7 rounded border border-gray-400 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      style={{ backgroundColor: hex }} onMouseDown={event => event.preventDefault()} onClick={() => onChange(hex)} />)}
  </div>;
}
