import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  applyOp,
  slugify,
  sortedValues,
  validateModel,
  type ApplyResult,
  type Diagnostic,
  type Element,
  type Id,
  type Model,
  type Op,
  type View,
} from '@aegon/core';
import {
  MANIFEST_PATH,
  commentPath,
  elementPath,
  flowPath,
  parseWorkspace,
  planWrite,
  relationPath,
  serializeWorkspace,
  viewPath,
  type WritePlan,
} from '@aegon/format-yaml';
import { applyWritePlan, readAll } from '@aegon/storage';
import { NodeFsStorage } from '@aegon/storage/node';

/**
 * Un workspace en disco, compartido por la CLI y el servidor MCP: lee los YAML, aplica `Op`s
 * (que `applyOp` valida) y escribe solo los archivos que cambiaron (`planWrite`). La app de
 * escritorio observa la carpeta, así que cada escritura aparece en vivo como cambio.
 */

export class WorkspaceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
  }
}

export interface ApplyOutcome extends ApplyResult {
  plan: WritePlan;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Sube desde `start` hasta encontrar un `aegon.yaml` (como git con `.git`); si no hay, `start`. */
export async function findWorkspaceRoot(start: string): Promise<string> {
  let dir = resolve(start);
  for (;;) {
    if (await exists(join(dir, MANIFEST_PATH))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

export class Workspace {
  readonly root: string;
  readonly storage: NodeFsStorage;
  /** Archivos leídos de la carpeta (incluye README y otros que Aegon no administra). */
  files = new Map<string, string>();
  model!: Model;
  /** Diagnósticos de lectura (sintaxis YAML, esquema, IDs) y de `validateModel`. */
  diagnostics: Diagnostic[] = [];

  private constructor(root: string) {
    this.root = root;
    this.storage = new NodeFsStorage(root);
  }

  /** Abre el workspace de la carpeta (o de la más cercana hacia arriba que tenga `aegon.yaml`). */
  static async open(dir: string, options: { searchUp?: boolean } = {}): Promise<Workspace> {
    const root = options.searchUp === false ? resolve(dir) : await findWorkspaceRoot(dir);
    const ws = new Workspace(root);
    await ws.reload();
    return ws;
  }

  /** Vuelve a leer la carpeta: toma los cambios hechos por la app, un editor o git. */
  async reload(): Promise<void> {
    // Antes de recorrer la carpeta: si no es un workspace no tiene sentido leerla entera.
    if (!(await exists(join(this.root, MANIFEST_PATH)))) {
      throw new WorkspaceError('not-a-workspace', `"${this.root}" no es un workspace de Aegon (falta ${MANIFEST_PATH}). Creá uno con \`aegon init\`.`);
    }
    const files = await readAll(this.storage);
    const parsed = parseWorkspace(files);
    this.files = files;
    this.model = parsed.model;
    this.diagnostics = parsed.diagnostics;
  }

  /** Diagnósticos completos: los de lectura más los informativos de `validateModel`. */
  validate(options: { info?: boolean } = {}): Diagnostic[] {
    if (!options.info) return this.diagnostics;
    const info = validateModel(this.model)
      .filter((d) => d.severity === 'info')
      .map((d) => {
        const file = d.entity ? this.fileOf(d.entity.type, d.entity.id) : undefined;
        return file ? { ...d, file } : d;
      });
    return [...this.diagnostics, ...info];
  }

  /** Archivo donde vive una entidad (si existe en disco). */
  fileOf(type: 'element' | 'relation' | 'view' | 'workspace' | 'flow' | 'comment', id: Id): string | undefined {
    const path =
      type === 'element' ? elementPath(id)
      : type === 'relation' ? relationPath(id)
      : type === 'view' ? viewPath(id)
      : type === 'flow' ? flowPath(id)
      : type === 'comment' ? commentPath(id)
      : MANIFEST_PATH;
    return this.files.has(path) ? path : undefined;
  }

  /** Aplica una operación (validada por `applyOp`) y la guarda en disco. Lanza `OpError` si es inválida. */
  async apply(op: Op): Promise<ApplyOutcome> {
    const result = applyOp(this.model, op);
    const plan = await this.save(result.model);
    return { ...result, plan };
  }

  /** Escribe el modelo: solo los archivos que cambiaron y borra los de entidades eliminadas. */
  async save(model: Model): Promise<WritePlan> {
    const next = serializeWorkspace(model, { previous: this.files });
    const plan = planWrite(this.files, next);
    await applyWritePlan(this.storage, plan);
    const files = new Map(this.files);
    for (const [path, content] of plan.writes) files.set(path, content);
    for (const path of plan.deletes) files.delete(path);
    this.files = files;
    this.model = model;
    this.diagnostics = parseWorkspace(files).diagnostics;
    return plan;
  }

  /** Busca un elemento por ID, por nombre exacto (sin distinguir mayúsculas) o por slug del nombre. */
  element(ref: string): Element {
    return resolveRef(sortedValues(this.model.elements), ref, 'elemento');
  }

  view(ref: string): View {
    return resolveRef(sortedValues(this.model.views), ref, 'lienzo');
  }
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

/** Resolución tolerante de referencias: ID, nombre o slug. Si hay ambigüedad, lo dice. */
export function resolveRef<T extends { id: Id; name: string }>(items: readonly T[], ref: string, noun: string): T {
  const byId = items.find((i) => i.id === ref);
  if (byId) return byId;
  const wanted = normalize(ref);
  const byName = items.filter((i) => normalize(i.name) === wanted);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) {
    throw new WorkspaceError('ambiguous', `Hay varios ${noun}s llamados "${ref}": ${byName.map((i) => i.id).join(', ')}. Usá el ID.`);
  }
  const slug = slugify(ref);
  const bySlug = items.find((i) => i.id === slug);
  if (bySlug) return bySlug;
  const near = items.filter((i) => i.id.includes(slug) || normalize(i.name).includes(wanted)).slice(0, 5);
  const hint = near.length ? ` ¿Quisiste decir ${near.map((i) => `"${i.id}"`).join(', ')}?` : '';
  throw new WorkspaceError('not-found', `No existe el ${noun} "${ref}".${hint}`);
}
