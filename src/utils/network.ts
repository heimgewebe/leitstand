/**
 * Checks if a remote address is a localhost/loopback address.
 *
 * Supports both IPv4 and IPv6 formats.
 * - 127.0.0.1 (IPv4)
 * - ::1 (IPv6)
 * - ::ffff:127.0.0.1 (IPv4-mapped IPv6)
 *
 * @param remoteAddress - The address to check
 * @returns true if the address is a known loopback address
 */
export function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  return remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
}
