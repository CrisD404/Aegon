import { access, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { applyOp, demoModel, emptyModel, slugify, type Model } from '@aegon/core';
import { MANIFEST_PATH, planWrite, serializeWorkspace } from '@aegon/format-yaml';
import { applyWritePlan, readAll } from '@aegon/storage';
import { NodeFsStorage } from '@aegon/storage/node';
import { json, plural, type Io } from '../io.ts';
import { WorkspaceError } from '../workspace.ts';

/** Igual que la app: un workspace nuevo arranca con un lienzo de contexto vacío. */
function withStarterView(model: Model): Model {
  if (Object.keys(model.views).length) return model;
  return applyOp(model, {
    type: 'batch',
    ops: [
      { type: 'view.add', view: { id: 'contexto', name: 'Contexto', level: 1, nodes: {} } },
      { type: 'workspace.update', patch: { defaultView: 'contexto' } },
    ],
  }).model;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface InitOptions {
  name?: string;
  demo: boolean;
  json: boolean;
}

/** `aegon init [carpeta]`: workspace vacío o el de ejemplo. */
export async function init(io: Io, dir: string | undefined, opts: InitOptions): Promise<number> {
  const root = resolve(io.cwd, dir ?? '.');
  if (await exists(join(root, MANIFEST_PATH))) throw new WorkspaceError('exists', `"${root}" ya es un workspace de Aegon`);

  let model: Model;
  if (opts.demo) {
    model = demoModel();
    if (opts.name) model = applyOp(model, { type: 'workspace.update', patch: { name: opts.name } }).model;
  } else {
    const name = opts.name ?? (basename(root) || 'Workspace');
    model = withStarterView(emptyModel(slugify(name, 'workspace'), name));
  }

  // En una carpeta con archivos (un repo existente) se respetan README, .gitignore, etc.
  const storage = new NodeFsStorage(root);
  const existing = (await exists(root)) && (await readdir(root)).length ? await readAll(storage) : new Map<string, string>();
  const plan = planWrite(existing, serializeWorkspace(model, { previous: existing }));
  await applyWritePlan(storage, plan);

  if (opts.json) {
    json(io, { root, workspace: model.workspace, written: [...plan.writes.keys()].sort() });
    return 0;
  }
  const counts = `${plural(Object.keys(model.elements).length, 'elemento', 'elementos')} · ${plural(Object.keys(model.views).length, 'lienzo', 'lienzos')}`;
  io.stdout(`✓ Workspace "${model.workspace.name}" creado en ${root} (${counts}, ${plural(plan.writes.size, 'archivo', 'archivos')})\n`);
  return 0;
}
