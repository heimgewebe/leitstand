import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { startServer } from '../src/server.js';

function waitForListening(server: Server): Promise<void> {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

describe('startServer binding', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server?.listening) await closeServer(server);
    server = undefined;
  });

  it('binds the explicit loopback host instead of an implicit wildcard', async () => {
    server = startServer({ port: 0, bindHost: '127.0.0.1', log: false });
    await waitForListening(server);
    const address = server.address() as AddressInfo;
    expect(address.address).toBe('127.0.0.1');
    expect(address.family).toBe('IPv4');
    expect(address.port).toBeGreaterThan(0);
  });

  it('supports explicit IPv6 loopback', async () => {
    server = startServer({ port: 0, bindHost: '::1', log: false });
    try {
      await waitForListening(server);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EAFNOSUPPORT') return;
      throw error;
    }
    const address = server.address() as AddressInfo;
    expect(address.address).toBe('::1');
    expect(address.family).toBe('IPv6');
  });
});
