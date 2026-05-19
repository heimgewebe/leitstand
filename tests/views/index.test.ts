import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import ejs from 'ejs';

describe('index.ejs', () => {
  it('renders without phases locals (static build safety)', async () => {
    const html = await ejs.renderFile(
      join(process.cwd(), 'src/views/index.ejs'),
      {},
      {
        async: true,
        localsName: 'locals',
      },
    );

    expect(html).toContain('Leitstand');
    expect(html).toContain('Die Phasenübersicht ist aktuell nicht verfügbar.');
  });
});
