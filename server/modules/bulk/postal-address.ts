/** Shared selection rule for delivery and mailing exports. Never discard a
 * selected address merely because its deliverability has not been verified. */
export function selectActivePostalAddress<T extends { isActive: boolean; isPrimary: boolean }>(
  addresses: T[],
): T | undefined {
  return addresses.find(address => address.isActive && address.isPrimary)
    ?? addresses.find(address => address.isActive);
}
