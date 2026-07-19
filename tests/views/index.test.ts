import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import ejs from 'ejs';

const viewPath = join(process.cwd(), 'src/views/index.ejs');
const renderOptions = {
  async: false,
  localsName: 'locals',
} as const;

describe('index.ejs', () => {
  it('renders without phases locals (static build safety)', async () => {
    const html = await ejs.renderFile(viewPath, {}, renderOptions);

    expect(html).toContain('Leitstand');
    expect(html).toContain('class="leitstand-nav"');
    expect(html).not.toContain('[object Promise]');
    expect(html).toContain('Die Quellenübersicht ist aktuell nicht verfügbar.');
  });

  it('renders the derived situation summary and prioritized attention links', async () => {
    const html = await ejs.renderFile(
      viewPath,
      {
        currentPath: '/',
        sources: [
          {
            id: 'bureau',
            title: 'Bureau',
            description: 'Tasks',
            href: '/bureau',
            source_kind: 'artifact',
            freshness_state: 'unknown',
            metric: '3 Tasks',
            error_reason: null,
          },
        ],
        summary: {
          state: 'attention',
          state_label: 'Prüfbedarf',
          headline: '1 Bereich benötigt Prüfung',
          total_count: 1,
          verified_fresh_count: 0,
          attention_count: 1,
          unavailable_count: 0,
          attention: [
            {
              source_id: 'bureau',
              title: 'Bureau',
              href: '/bureau',
              severity: 'info',
              reason: 'Datenfrische ist nicht belegt',
            },
          ],
        },
      },
      renderOptions,
    );

    expect(html).toContain('data-dashboard-state="attention"');
    expect(html).toContain('1 Bereich benötigt Prüfung');
    expect(html).toContain('data-attention-source="bureau"');
    expect(html).toContain('Datenfrische ist nicht belegt');
    expect(html).toContain('Es erzeugt keine eigene Zustandswahrheit.');
  });
});
