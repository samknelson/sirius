/** Only the numeric / uppercase-I convention is an identity alias. */
export function t631IdentityValues(value: string): string[] {
  if (/^I[0-9]+$/.test(value)) return [value, value.slice(1)];
  if (/^[0-9]+$/.test(value)) return [value, `I${value}`];
  return [value];
}
