import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Model } from '@aegon/core';
import { parseWorkspace, serializeWorkspace } from '@aegon/format-yaml';
import { readAll } from '@aegon/storage';
import { NodeFsStorage } from '@aegon/storage/node';
import { run } from './cli.ts';

/** Utilidades de test compartidas por la CLI y el servidor MCP. */

export const FIXTURES = fileURLToPath(new URL('../../../fixtures', import.meta.url));

const temps: string[] = [];

/** Carpeta temporal con el modelo serializado como workspace de Aegon. */
export function tempWorkspace(model: Model, options: { git?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'aegon-ws-'));
  temps.push(dir);
  for (const [path, content] of serializeWorkspace(model)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  if (options.git) {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('-c', 'user.email=test@aegon.dev', '-c', 'user.name=Test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'inicial');
  }
  return dir;
}

/** Copia de un fixture del repo en una carpeta temporal (para poder modificarla). */
export function tempCopy(fixture: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'aegon-fx-'));
  temps.push(dir);
  cpSync(join(FIXTURES, fixture), dir, { recursive: true });
  return dir;
}

export function cleanupTemps() {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Modelo tal como quedó en disco. */
export async function modelOnDisk(dir: string): Promise<Model> {
  return parseWorkspace(await readAll(new NodeFsStorage(dir))).model;
}

export interface CliResult {
  code: number;
  out: string;
  err: string;
}

/** Corre la CLI en el mismo proceso, capturando la salida. */
export async function cli(cwd: string, ...args: string[]): Promise<CliResult> {
  let out = '';
  let err = '';
  const code = await run(args, { cwd, stdout: (t) => (out += t), stderr: (t) => (err += t) });
  return { code, out, err };
}
