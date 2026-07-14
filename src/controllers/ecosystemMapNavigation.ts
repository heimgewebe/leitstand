import type { EcosystemCrossViewLink } from './ecosystemMapLinks.js';

export type EcosystemMapNavigationTargetKind = 'leitstand' | 'systemkatalog';

export interface EcosystemMapNodeNavigation {
  mermaid_id: string;
  node_id: string;
  label: string;
  href: string;
  title: string;
  target_kind: EcosystemMapNavigationTargetKind;
  source_href: string;
}

interface MermaidNodeIdentity {
  mermaidId: string;
  nodeId: string;
  label: string;
  line: number;
}

const NODE_DEFINITION = /^\s*([A-Za-z][A-Za-z0-9_]*)\["([^"\n]*?)<br\s*\/?\s*>id:\s*([^<"\n]+)<br\s*\/?\s*>/;
const SOURCE_COMMIT = /^[0-9a-f]{40}$/;
const SOURCE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function encodeRepository(repository: string): string {
  return repository.split('/').map(encodeURIComponent).join('/');
}

function encodeArtifactPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function canonicalSourceHref(
  repository: string,
  commit: string,
  artifactPath: string,
  line: number,
): string {
  if (!SOURCE_REPOSITORY.test(repository) || !SOURCE_COMMIT.test(commit)) {
    throw new Error('invalid Systemkatalog source identity');
  }
  if (!artifactPath || artifactPath.startsWith('/') || artifactPath.split('/').includes('..')) {
    throw new Error('invalid Systemkatalog artifact path');
  }
  return `https://github.com/${encodeRepository(repository)}/blob/${commit}/${encodeArtifactPath(artifactPath)}?plain=1#L${line}`;
}

export function extractMermaidNodeIdentities(content: string): MermaidNodeIdentity[] {
  const identities: MermaidNodeIdentity[] = [];
  const seenMermaidIds = new Set<string>();
  const seenNodeIds = new Set<string>();

  for (const [index, line] of content.split('\n').entries()) {
    const match = NODE_DEFINITION.exec(line);
    if (!match) continue;

    const [, mermaidId, labelValue, nodeIdValue] = match;
    const label = labelValue.trim();
    const nodeId = nodeIdValue.trim();
    if (!label || !nodeId || seenMermaidIds.has(mermaidId) || seenNodeIds.has(nodeId)) continue;

    seenMermaidIds.add(mermaidId);
    seenNodeIds.add(nodeId);
    identities.push({ mermaidId, nodeId, label, line: index + 1 });
  }

  return identities;
}

export function buildEcosystemMapNavigation(
  mapContent: string,
  crossLinks: EcosystemCrossViewLink[],
  sourceRepository: string,
  sourceCommit: string,
  mapPath: string,
): EcosystemMapNodeNavigation[] {
  const linkByNodeId = new Map(crossLinks.map((link) => [link.node_id, link]));

  return extractMermaidNodeIdentities(mapContent).map((identity) => {
    const sourceHref = canonicalSourceHref(
      sourceRepository,
      sourceCommit,
      mapPath,
      identity.line,
    );
    const mapped = linkByNodeId.get(identity.nodeId);
    const target = mapped?.status === 'linked' ? mapped.links[0] : undefined;

    return {
      mermaid_id: identity.mermaidId,
      node_id: identity.nodeId,
      label: identity.label,
      href: target?.href || sourceHref,
      title: target?.title || `${identity.label} im kanonischen Systemkatalog öffnen`,
      target_kind: target ? 'leitstand' : 'systemkatalog',
      source_href: sourceHref,
    };
  });
}

export function serializeEcosystemMapNavigation(navigation: EcosystemMapNodeNavigation[]): string {
  return JSON.stringify(navigation)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
