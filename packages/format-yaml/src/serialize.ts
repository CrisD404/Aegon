import { Document, isMap, isScalar, isSeq, parseDocument, visit, type YAMLMap } from 'yaml';
import {
  deepEqual,
  sortedValues,
  type Comment,
  type Element,
  type Flow,
  type Model,
  type Relation,
  type View,
  type WorkspaceMeta,
} from '@aegon/core';
import {
  AGENTS_PATH,
  GITATTRIBUTES_PATH,
  GITIGNORE_PATH,
  MANIFEST_PATH,
  classifyPath,
  commentPath,
  elementPath,
  flowPath,
  relationPath,
  viewPath,
} from './paths.ts';
import { agentsMd, GITATTRIBUTES, GITIGNORE } from './agents-md.ts';

/** Orden canónico de claves: el YAML resultante es estable y fácil de revisar en un diff. */
const ORDER = {
  workspace: ['schema', 'id', 'name', 'description', 'organization', 'architect', 'defaultView', 'environments', 'finops', 'extensions'],
  element: [
    'id', 'kind', 'name', 'description', 'parent', 'groups', 'scope', 'status', 'risk', 'technology',
    'containerType', 'role', 'store', 'bus', 'group', 'owner', 'tags', 'links', 'environments', 'finops',
    'properties', 'docs', 'extensions',
  ],
  relation: ['id', 'from', 'to', 'label', 'description', 'protocols', 'direction', 'status', 'tags', 'properties', 'extensions'],
  view: ['id', 'name', 'level', 'scope', 'description', 'nodes', 'edges', 'extensions'],
  store: ['engine', 'customEngine', 'customIcon', 'type', 'version', 'managed'],
  bus: ['broker', 'customBroker', 'customIcon', 'type', 'topics'],
  group: ['provider', 'region', 'account', 'cidr'],
  layout: ['x', 'y', 'w', 'h'],
  link: ['label', 'url'],
  edge: ['shape', 'hidden'],
  environment: ['id', 'name'],
  finopsSettings: ['currency', 'tagKeys', 'budgets'],
  finops: ['costs', 'tags'],
  cost: ['monthly', 'replicas', 'sku', 'note'],
  flow: ['id', 'name', 'description', 'view', 'steps', 'extensions'],
  step: ['type', 'mode', 'from', 'to', 'relation', 'element', 'flow', 'title', 'description', 'paths'],
  path: ['name', 'steps'],
  comment: ['id', 'view', 'element', 'x', 'y', 'icon', 'color', 'title', 'body', 'author', 'at', 'edited', 'resolved', 'replies'],
  reply: ['author', 'at', 'body'],
} as const;

function ordered(value: Record<string, unknown>, order: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of order) if (value[key] !== undefined) out[key] = value[key];
  for (const key of Object.keys(value).sort()) {
    if (!(key in out) && value[key] !== undefined) out[key] = value[key];
  }
  return out;
}

function orderedRecord<T>(record: Record<string, T>, fn: (v: T) => unknown, first: readonly string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of first) if (key in record) out[key] = fn(record[key]!);
  for (const key of Object.keys(record).sort()) if (!(key in out)) out[key] = fn(record[key]!);
  return out;
}

/** `environments`: orden de los ambientes del workspace (los costos se escriben en ese orden). */
export function canonicalElement(el: Element, environments: readonly string[] = []): Record<string, unknown> {
  const value: Record<string, unknown> = { ...el };
  if ('store' in el && el.store) value.store = ordered(el.store, ORDER.store);
  if ('bus' in el && el.bus) value.bus = ordered(el.bus, ORDER.bus);
  if ('group' in el && el.group) value.group = ordered(el.group, ORDER.group);
  if (el.links) value.links = el.links.map((l) => ordered(l, ORDER.link));
  if (el.properties) value.properties = orderedRecord(el.properties, (v) => v);
  if (el.finops) {
    const finops: Record<string, unknown> = { ...el.finops };
    if (el.finops.costs) finops.costs = orderedRecord(el.finops.costs, (c) => ordered(c, ORDER.cost), environments);
    if (el.finops.tags) finops.tags = orderedRecord(el.finops.tags, (v) => v);
    value.finops = ordered(finops, ORDER.finops);
  }
  return ordered(value, ORDER.element);
}

export function canonicalRelation(rel: Relation): Record<string, unknown> {
  return ordered({ ...rel }, ORDER.relation);
}

export function canonicalView(view: View): Record<string, unknown> {
  const value: Record<string, unknown> = { ...view };
  value.nodes = orderedRecord(view.nodes, (l) => ordered(l, ORDER.layout));
  if (view.edges) value.edges = orderedRecord(view.edges, (e) => ordered(e, ORDER.edge));
  return ordered(value, ORDER.view);
}

function canonicalStep(step: Flow['steps'][number]): Record<string, unknown> {
  const value: Record<string, unknown> = { ...step };
  if (step.type === 'paths') {
    value.paths = step.paths.map((p) => ordered({ ...p, steps: p.steps.map(canonicalStep) }, ORDER.path));
  }
  return ordered(value, ORDER.step);
}

export function canonicalFlow(flow: Flow): Record<string, unknown> {
  return ordered({ ...flow, steps: flow.steps.map(canonicalStep) }, ORDER.flow);
}

export function canonicalComment(comment: Comment): Record<string, unknown> {
  const value: Record<string, unknown> = { ...comment };
  if (comment.replies) value.replies = comment.replies.map((r) => ordered(r, ORDER.reply));
  return ordered(value, ORDER.comment);
}

export function canonicalWorkspace(ws: WorkspaceMeta): Record<string, unknown> {
  const value: Record<string, unknown> = { ...ws };
  if (ws.environments) value.environments = ws.environments.map((e) => ordered(e, ORDER.environment));
  if (ws.finops) {
    const finops: Record<string, unknown> = { ...ws.finops };
    if (ws.finops.budgets) finops.budgets = orderedRecord(ws.finops.budgets, (v) => v, ws.environments?.map((e) => e.id));
    value.finops = ordered(finops, ORDER.finopsSettings);
  }
  return ordered(value, ORDER.workspace);
}

/** Mapas en una línea (`{ x: 0, y: 0 }`) para layouts y estilos; listas de escalares en una línea. */
function toYaml(value: Record<string, unknown>, flowMapsUnder: readonly string[] = []): string {
  const doc = new Document(value);
  visit(doc, {
    Seq(_, node) {
      if (node.items.every((item) => isScalar(item))) node.flow = true;
    },
  });
  if (isMap(doc.contents)) {
    // Secciones (con rutas `a.b`) cuyos mapas hijos van en una línea: `{ x: 0, y: 0 }`.
    for (const key of flowMapsUnder) {
      const section = doc.contents.getIn(key.split('.'), true);
      if (isMap(section)) {
        for (const pair of (section as YAMLMap).items) if (isMap(pair.value)) pair.value.flow = true;
      } else if (isSeq(section)) {
        for (const item of section.items) if (isMap(item)) item.flow = true;
      }
    }
  }
  return doc.toString({ lineWidth: 0, flowCollectionPadding: true });
}

/** Bloque de comentarios al inicio del archivo (`# ...`), tal cual estaba escrito. */
function headerComment(previous: string | undefined): string | null {
  if (!previous) return null;
  const lines: string[] = [];
  for (const line of previous.split(/\r?\n/)) {
    if (!line.startsWith('#')) break;
    lines.push(line);
  }
  return lines.length ? lines.join('\n') : null;
}

/**
 * Reutiliza el texto anterior si el contenido no cambió (preserva comentarios y formato a mano);
 * si cambió, regenera manteniendo el comentario de cabecera.
 */
function render(value: Record<string, unknown>, previous: string | undefined, flowMapsUnder?: readonly string[]): string {
  if (previous !== undefined) {
    try {
      const prevValue = parseDocument(previous).toJS();
      if (deepEqual(prevValue, JSON.parse(JSON.stringify(value)))) return previous;
    } catch {
      // El archivo anterior era inválido: se regenera.
    }
  }
  const body = toYaml(value, flowMapsUnder);
  const comment = headerComment(previous);
  return comment ? `${comment}\n${body}` : body;
}

export interface SerializeOptions {
  /** Archivos actuales en disco/repo: se usan para conservar comentarios y archivos de soporte. */
  previous?: ReadonlyMap<string, string>;
  /** Generar `AGENTS.md` y `.gitignore` si no existen (por defecto true). */
  supportFiles?: boolean;
}

/** Modelo → archivos (ruta POSIX → contenido). Determinista. */
export function serializeWorkspace(model: Model, options: SerializeOptions = {}): Map<string, string> {
  const prev = options.previous ?? new Map<string, string>();
  const files = new Map<string, string>();
  files.set(MANIFEST_PATH, render(canonicalWorkspace(model.workspace), prev.get(MANIFEST_PATH), ['environments', 'finops.budgets']));
  const environments = model.workspace.environments?.map((e) => e.id) ?? [];
  for (const el of sortedValues(model.elements)) {
    const path = elementPath(el.id);
    files.set(path, render(canonicalElement(el, environments), prev.get(path), ['finops.costs']));
  }
  for (const rel of sortedValues(model.relations)) {
    const path = relationPath(rel.id);
    files.set(path, render(canonicalRelation(rel), prev.get(path)));
  }
  for (const view of sortedValues(model.views)) {
    const path = viewPath(view.id);
    files.set(path, render(canonicalView(view), prev.get(path), ['nodes', 'edges']));
  }
  for (const flow of sortedValues(model.flows ?? {})) {
    const path = flowPath(flow.id);
    files.set(path, render(canonicalFlow(flow), prev.get(path)));
  }
  for (const comment of sortedValues(model.comments ?? {})) {
    const path = commentPath(comment.id);
    files.set(path, render(canonicalComment(comment), prev.get(path)));
  }
  for (const [path, content] of Object.entries(model.passthrough ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    files.set(path, content);
  }
  if (options.supportFiles !== false) {
    files.set(AGENTS_PATH, prev.get(AGENTS_PATH) ?? agentsMd(model.workspace.name));
    files.set(GITIGNORE_PATH, ensureGitignore(prev.get(GITIGNORE_PATH)));
    // Saltos de línea LF en el working tree (evita diffs falsos con core.autocrlf en Windows).
    files.set(GITATTRIBUTES_PATH, prev.get(GITATTRIBUTES_PATH) ?? GITATTRIBUTES);
  }
  return files;
}

const normalizeEol = (text: string) => text.replace(/\r\n/g, '\n');

function ensureGitignore(previous: string | undefined): string {
  if (!previous) return GITIGNORE;
  if (/^\.aegon\/?$/m.test(previous)) return previous;
  return `${previous.replace(/\n*$/, '\n')}\n${GITIGNORE}`;
}

export interface WritePlan {
  writes: Map<string, string>;
  deletes: string[];
}

/**
 * Qué escribir y qué borrar para pasar de `previous` a `next`. Solo borra archivos que Aegon
 * administra (modelo, vistas, adjuntos); nunca toca README, código u otros archivos del repo.
 */
export function planWrite(previous: ReadonlyMap<string, string>, next: ReadonlyMap<string, string>): WritePlan {
  const writes = new Map<string, string>();
  for (const [path, content] of next) {
    const prev = previous.get(path);
    if (prev === undefined || normalizeEol(prev) !== normalizeEol(content)) writes.set(path, content);
  }
  const deletes: string[] = [];
  for (const path of previous.keys()) {
    if (next.has(path)) continue;
    const kind = classifyPath(path);
    if (kind && kind.type !== 'manifest') deletes.push(path);
  }
  return { writes, deletes: deletes.sort() };
}
