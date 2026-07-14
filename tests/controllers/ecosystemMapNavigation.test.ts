import { describe, expect, it } from 'vitest';
import {
  buildEcosystemMapNavigation,
  extractMermaidNodeIdentities,
  serializeEcosystemMapNavigation,
} from '../../src/controllers/ecosystemMapNavigation.js';
import type { EcosystemCrossViewLink } from '../../src/controllers/ecosystemMapLinks.js';

const COMMIT = 'a'.repeat(40);
const MAP = [
  'flowchart TD',
  '  repo_bureau["Bureau<br/>id: repo:bureau<br/>repository<br/>task cadence"]',
  '  repo_systemkatalog["Systemkatalog<br/>id: repo:systemkatalog<br/>repository<br/>catalog"]',
  '  service_github["GitHub<br/>id: service:github<br/>service<br/>repository state"]',
  '  repo_bureau --> repo_systemkatalog',
].join('\n');

const LINKS: EcosystemCrossViewLink[] = [
  {
    node_id: 'repo:bureau',
    label: 'Bureau',
    status: 'linked',
    reason: null,
    links: [{ view: 'bureau', href: '/bureau', title: 'Bureau task view' }],
  },
];

describe('ecosystem map node navigation', () => {
  it('extracts stable node IDs and source lines from the generated Mermaid map', () => {
    expect(extractMermaidNodeIdentities(MAP)).toEqual([
      { mermaidId: 'repo_bureau', nodeId: 'repo:bureau', label: 'Bureau', line: 2 },
      { mermaidId: 'repo_systemkatalog', nodeId: 'repo:systemkatalog', label: 'Systemkatalog', line: 3 },
      { mermaidId: 'service_github', nodeId: 'service:github', label: 'GitHub', line: 4 },
    ]);
  });

  it('uses explicit Leitstand mappings and exact commit-bound Systemkatalog fallbacks', () => {
    const navigation = buildEcosystemMapNavigation(
      MAP,
      LINKS,
      'heimgewebe/systemkatalog',
      COMMIT,
      'rendered/ecosystem-registry-map.mmd',
    );

    expect(navigation).toHaveLength(3);
    expect(navigation[0]).toMatchObject({
      node_id: 'repo:bureau',
      href: '/bureau',
      target_kind: 'leitstand',
    });
    expect(navigation[1]).toMatchObject({
      node_id: 'repo:systemkatalog',
      target_kind: 'systemkatalog',
      href: `https://github.com/heimgewebe/systemkatalog/blob/${COMMIT}/rendered/ecosystem-registry-map.mmd?plain=1#L3`,
    });
    expect(navigation[2].source_href).toContain(`/${COMMIT}/rendered/ecosystem-registry-map.mmd?plain=1#L4`);
  });

  it('serializes navigation without allowing an inline script terminator', () => {
    const navigation = buildEcosystemMapNavigation(
      MAP,
      [{
        ...LINKS[0],
        links: [{ view: 'bureau', href: '/bureau', title: '</script><script>alert(1)</script>' }],
      }],
      'heimgewebe/systemkatalog',
      COMMIT,
      'rendered/ecosystem-registry-map.mmd',
    );
    const serialized = serializeEcosystemMapNavigation(navigation);

    expect(serialized).not.toContain('</script>');
    expect(JSON.parse(serialized)[0].title).toBe('</script><script>alert(1)</script>');
  });

  it('rejects invalid source identities rather than creating an unbound fallback', () => {
    expect(() => buildEcosystemMapNavigation(
      MAP,
      [],
      'heimgewebe/systemkatalog',
      'main',
      'rendered/ecosystem-registry-map.mmd',
    )).toThrow('invalid Systemkatalog source identity');
  });
});
