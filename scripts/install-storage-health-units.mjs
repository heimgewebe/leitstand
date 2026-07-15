#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { chmod, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function parseArgs(argv) {
  const options = {
    releaseRoot: process.cwd(),
    heimPcRoot: '/home/alex/repos/heim-pc',
    artifactRoot: '/home/alex/repos/leitstand/artifacts',
    stateRoot: join(homedir(), '.local', 'state', 'leitstand', 'storage-health'),
    unitDir: join(homedir(), '.config', 'systemd', 'user'),
  };
  const names = new Map([
    ['--release-root', 'releaseRoot'],
    ['--heim-pc-root', 'heimPcRoot'],
    ['--artifact-root', 'artifactRoot'],
    ['--state-root', 'stateRoot'],
    ['--unit-dir', 'unitDir'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = names.get(argv[index]);
    const value = argv[index + 1];
    if (!key || !value) throw new Error(`unknown or incomplete argument: ${argv[index]}`);
    options[key] = value;
    index += 1;
  }
  for (const [key, value] of Object.entries(options)) {
    if (!isAbsolute(value)) throw new Error(`${key} must be absolute`);
    options[key] = resolve(value);
  }
  return options;
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, path);
    await chmod(path, 0o644);
  } finally {
    await rm(temp, { force: true });
  }
}

export async function installStorageHealthUnits(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const releaseRoot = await realpath(options.releaseRoot);
  const templates = [
    'leitstand-storage-health.service',
    'leitstand-storage-health.timer',
  ];
  const replacements = new Map([
    ['@RELEASE_ROOT@', releaseRoot],
    ['@HEIM_PC_ROOT@', options.heimPcRoot],
    ['@LEITSTAND_ARTIFACT_ROOT@', options.artifactRoot],
    ['@STATE_ROOT@', options.stateRoot],
  ]);
  const installed = [];
  for (const name of templates) {
    const source = join(releaseRoot, 'deploy', 'systemd', name);
    let content = await readFile(source, 'utf8');
    for (const [placeholder, value] of replacements) content = content.replaceAll(placeholder, value);
    if (content.includes('@RELEASE_ROOT@') || content.includes('@HEIM_PC_ROOT@')
      || content.includes('@LEITSTAND_ARTIFACT_ROOT@') || content.includes('@STATE_ROOT@')) {
      throw new Error(`unresolved placeholder in ${name}`);
    }
    const target = join(options.unitDir, name);
    await atomicWrite(target, content);
    installed.push({ name, target, sha256: sha256(content), bytes: Buffer.byteLength(content) });
  }
  const receipt = {
    schemaVersion: 1,
    kind: 'leitstand_storage_health_unit_install_receipt',
    releaseRoot,
    heimPcRoot: options.heimPcRoot,
    artifactRoot: options.artifactRoot,
    stateRoot: options.stateRoot,
    installed,
    doesNotEstablish: ['systemd_daemon_reload', 'timer_enabled', 'collector_success'],
  };
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  return receipt;
}

const directRun = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (directRun) {
  installStorageHealthUnits().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
