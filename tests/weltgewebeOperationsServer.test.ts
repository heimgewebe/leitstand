import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';

const OLD_PATH = process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_PATH;
const OLD_FIXTURE = process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_FIXTURE_FALLBACK;
const OLD_STRICT = process.env.LEITSTAND_STRICT;

describe('GET /weltgewebe', () => {
  beforeEach(() => {
    delete process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_PATH;
    process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_FIXTURE_FALLBACK = '1';
    delete process.env.LEITSTAND_STRICT;
  });

  afterEach(() => {
    if (OLD_PATH === undefined) delete process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_PATH;
    else process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_PATH = OLD_PATH;
    if (OLD_FIXTURE === undefined) delete process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_FIXTURE_FALLBACK;
    else process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_FIXTURE_FALLBACK = OLD_FIXTURE;
    if (OLD_STRICT === undefined) delete process.env.LEITSTAND_STRICT;
    else process.env.LEITSTAND_STRICT = OLD_STRICT;
  });

  it('renders source-bound SLO, recovery, cell and federation evidence read-only', async () => {
    const res = await request(app).get('/weltgewebe');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Weltgewebe-Betrieb');
    expect(res.text).toContain('Fehlerbudget verbleibend');
    expect(res.text).toContain('RTO / RPO');
    expect(res.text).toContain('cell-hamburg');
    expect(res.text).toContain('Föderation');
    expect(res.text).toContain('WELTGEWEBE-OS-V1-T008');
    expect(res.text).toContain('Snapshot-Provenienz');
    expect(res.text).toContain('Bureau read-only öffnen');
  });

  it('does not expose a state-changing browser surface', async () => {
    const res = await request(app).get('/weltgewebe');

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<form');
    expect(res.text).not.toContain('method="post"');
    expect(res.text).not.toContain('data-action');
    expect(res.text).not.toContain('kubectl');
    expect(res.text).not.toContain('mutationUrl');
    expect(res.text).not.toContain('actionUrl');
  });
});
