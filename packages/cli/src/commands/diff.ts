import { diffModels, emptyModel, summarizeChange, type Change, type Model } from '@aegon/core';
import { isAegonWorkspace, parseWorkspace } from '@aegon/format-yaml';
import { CliGitSync, isAegonFile } from '@aegon/git';
import { NodeGitBackend } from '@aegon/git/node';
import { json, plural, type Io } from '../io.ts';
import { WorkspaceError, type Workspace } from '../workspace.ts';

const MARK = { added: '+', modified: '~', removed: '-' } as const;

function show(value: unknown): string {
  if (value === undefined) return '∅';
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/** Modelo del workspace en un commit (vacío si la rama todavía no tiene commits). */
async function modelAt(ws: Workspace, ref: string): Promise<Model> {
  const backend = new NodeGitBackend(ws.root);
  const git = new CliGitSync(backend, ws.storage);
  if (!(await git.isRepo())) throw new WorkspaceError('not-a-repo', `"${ws.root}" no está dentro de un repo git`);
  const commit = await backend.run(['rev-parse', '--verify', '-q', `${ref}^{commit}`]);
  if (commit.code !== 0) {
    const unborn = ref === 'HEAD' && (await backend.run(['rev-parse', '--verify', '-q', 'HEAD'])).code !== 0;
    if (unborn) return emptyModel(ws.model.workspace.id, ws.model.workspace.name);
    throw new WorkspaceError('bad-ref', `No existe la referencia "${ref}"`);
  }
  const files = await git.readFiles(commit.stdout.trim(), isAegonFile);
  if (!isAegonWorkspace(files)) return emptyModel(ws.model.workspace.id, ws.model.workspace.name);
  return parseWorkspace(files, { validate: false }).model;
}

/** `aegon diff [ref]`: cambios semánticos del modelo entre un commit y la carpeta. */
export async function diff(io: Io, ws: Workspace, ref: string, opts: { json: boolean }): Promise<number> {
  const base = await modelAt(ws, ref);
  const changes: Change[] = diffModels(base, ws.model);
  if (opts.json) {
    json(io, { ref, changes });
    return 0;
  }
  if (!changes.length) {
    io.stdout(`Sin cambios en el modelo respecto de ${ref}\n`);
    return 0;
  }
  for (const change of changes) {
    io.stdout(`${MARK[change.kind]} ${summarizeChange(change)}\n`);
    if (change.kind !== 'modified' || change.entity === 'view') continue;
    for (const f of change.fields) io.stdout(`    ${f.path}: ${show(f.before)} → ${show(f.after)}\n`);
  }
  io.stdout(`\n${plural(changes.length, 'cambio', 'cambios')} respecto de ${ref}\n`);
  return 0;
}
