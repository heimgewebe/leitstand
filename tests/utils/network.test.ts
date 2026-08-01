import { describe, expect, it } from 'vitest';
import { isLoopbackAddress } from '../../src/utils/network.js';

describe('isLoopbackAddress', () => {
  it.each([
    ['IPv4 loopback', '127.0.0.1'],
    ['IPv6 loopback', '::1'],
    ['IPv4-mapped IPv6 loopback', '::ffff:127.0.0.1'],
  ])('accepts the supported %s form', (_label, address) => {
    expect(isLoopbackAddress(address)).toBe(true);
  });

  it.each([
    ['an absent address', undefined],
    ['an empty address', ''],
    ['the IPv4 wildcard', '0.0.0.0'],
    ['the IPv6 wildcard', '::'],
    ['a regular IPv4 address', '192.0.2.10'],
    ['a regular IPv6 address', '2001:db8::10'],
  ])('rejects %s', (_label, address) => {
    expect(isLoopbackAddress(address)).toBe(false);
  });
});
