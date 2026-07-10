import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8');
}

describe('Docker binding contract', () => {
  it('acknowledges the required in-container wildcard explicitly', () => {
    const compose = read('deploy/docker-compose.yml');
    expect(compose).toContain('LEITSTAND_BIND_HOST: "0.0.0.0"');
    expect(compose).toContain('LEITSTAND_ALLOW_WIDE_BIND: "true"');
  });

  it('keeps host publication loopback-first and LAN publication explicit', () => {
    expect(read('deploy/docker-compose.loopback.yml')).toContain('127.0.0.1:3000:3000');
    expect(read('deploy/docker-compose.lan.yml')).toContain('${LEITSTAND_BIND_IP:?set LEITSTAND_BIND_IP}:3000:3000');
  });
});
