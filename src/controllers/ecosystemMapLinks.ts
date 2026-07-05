import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export type EcosystemCrossLinkStatus = 'linked' | 'unmapped';
export type EcosystemCrossLinkSourceKind = 'artifact' | 'missing' | 'corrupt';

export interface EcosystemCrossViewTarget {
  view: string;
  href: string;
  title: string;
}

export interface EcosystemCrossViewLink {
  node_id: string;
  label: string;
  status: EcosystemCrossLinkStatus;
  reason: string | null;
  links: EcosystemCrossViewTarget[];
}

export interface EcosystemCrossLinkData {
  links: EcosystemCrossViewLink[];
  meta: {
    source_kind: EcosystemCrossLinkSourceKind;
    source_path: string;
    missing_reason: string;
    does_not_establish: string[];
  };
}

const CONTRACT_KIND = 'leitstand_ecosystem_map_cross_view_links';
const DEFAULT_NON_CLAIMS = [
  'relation_truth',
  'runtime_dependency',
  'change_impact',
  'claim_truth',
  'dispatch_readiness',
];

function configuredLinksPath(): string {
  return process.env.LEITSTAND_ECOSYSTEM_MAP_LINKS_PATH
    || join(process.cwd(), 'src', 'fixtures', 'ecosystem-map-links.json');
}

function emptyLinkData(kind: EcosystemCrossLinkSourceKind, reason: string, sourcePath: string): EcosystemCrossLinkData {
  return {
    links: [],
    meta: {
      source_kind: kind,
      source_path: sourcePath,
      missing_reason: reason,
      does_not_establish: DEFAULT_NON_CLAIMS,
    },
  };
}

function classifyError(error: unknown): { kind: EcosystemCrossLinkSourceKind; reason: string } {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('enoent') || message.includes('no such file')) {
    return { kind: 'missing', reason: 'cross_link_contract_missing' };
  }
  if (message.includes('json') || message.includes('invalid') || message.includes('unexpected')) {
    return { kind: 'corrupt', reason: 'cross_link_contract_corrupt' };
  }
  return { kind: 'corrupt', reason: 'cross_link_contract_load_failed' };
}

function parseTarget(raw: unknown): EcosystemCrossViewTarget {
  if (!raw || typeof raw !== 'object') {
    throw new Error('invalid cross-view target: must be object');
  }
  const target = raw as Partial<EcosystemCrossViewTarget>;
  if (!target.view || !target.href || !target.title) {
    throw new Error('invalid cross-view target: missing fields');
  }
  if (!target.href.startsWith('/')) {
    throw new Error('invalid cross-view target: href must be local');
  }
  return {
    view: String(target.view),
    href: String(target.href),
    title: String(target.title),
  };
}

function parseLink(raw: unknown): EcosystemCrossViewLink {
  if (!raw || typeof raw !== 'object') {
    throw new Error('invalid cross-view link: must be object');
  }
  const link = raw as {
    nodeId?: unknown;
    label?: unknown;
    status?: unknown;
    reason?: unknown;
    links?: unknown;
  };
  const nodeId = typeof link.nodeId === 'string' ? link.nodeId : '';
  const label = typeof link.label === 'string' ? link.label : '';
  if (!nodeId || !label) {
    throw new Error('invalid cross-view link: nodeId and label are required');
  }
  if (link.status !== 'linked' && link.status !== 'unmapped') {
    throw new Error('invalid cross-view link: unsupported status');
  }
  const targets = Array.isArray(link.links) ? link.links.map(parseTarget) : [];
  if (link.status === 'linked' && targets.length === 0) {
    throw new Error('invalid cross-view link: linked nodes need at least one target');
  }
  if (link.status === 'unmapped' && targets.length !== 0) {
    throw new Error('invalid cross-view link: unmapped nodes must not have targets');
  }
  return {
    node_id: nodeId,
    label,
    status: link.status,
    reason: typeof link.reason === 'string' ? link.reason : null,
    links: targets,
  };
}

function parseContract(raw: unknown): Omit<EcosystemCrossLinkData, 'meta'> & { nonClaims: string[] } {
  if (!raw || typeof raw !== 'object') {
    throw new Error('invalid cross-link contract: root must be object');
  }
  const contract = raw as {
    schemaVersion?: unknown;
    kind?: unknown;
    mappings?: unknown;
    doesNotEstablish?: unknown;
  };
  if (contract.schemaVersion !== 1 || contract.kind !== CONTRACT_KIND) {
    throw new Error('invalid cross-link contract: kind or schemaVersion mismatch');
  }
  if (!Array.isArray(contract.mappings)) {
    throw new Error('invalid cross-link contract: mappings must be a list');
  }
  const links = contract.mappings.map(parseLink);
  const seen = new Set<string>();
  for (const link of links) {
    if (seen.has(link.node_id)) {
      throw new Error(`invalid cross-link contract: duplicate node ${link.node_id}`);
    }
    seen.add(link.node_id);
  }
  const nonClaims = Array.isArray(contract.doesNotEstablish)
    ? contract.doesNotEstablish.filter((item): item is string => typeof item === 'string')
    : DEFAULT_NON_CLAIMS;
  return { links, nonClaims };
}

export function resolveEcosystemCrossLink(
  data: EcosystemCrossLinkData,
  nodeId: string,
): EcosystemCrossViewLink {
  return data.links.find((link) => link.node_id === nodeId) || {
    node_id: nodeId,
    label: nodeId,
    status: 'unmapped',
    reason: 'node_id_not_in_cross_view_contract',
    links: [],
  };
}

export async function loadEcosystemCrossLinks(): Promise<EcosystemCrossLinkData> {
  const sourcePath = resolve(configuredLinksPath());
  try {
    const raw = JSON.parse(await readFile(sourcePath, 'utf-8')) as unknown;
    const parsed = parseContract(raw);
    return {
      links: parsed.links,
      meta: {
        source_kind: 'artifact',
        source_path: sourcePath,
        missing_reason: 'ok',
        does_not_establish: parsed.nonClaims,
      },
    };
  } catch (error) {
    const classified = classifyError(error);
    return emptyLinkData(classified.kind, classified.reason, sourcePath);
  }
}
