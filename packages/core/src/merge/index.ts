import type { Model } from '../model/index.ts';
import type { Element, Id, Relation, View } from '../schema/index.ts';
import { deepEqual } from '../diff/index.ts';

/**
 * Merge semántico de tres vías (base, nuestro, de ellos) por entidad y, dentro de cada entidad,
 * por campo. En los lienzos se mezcla nodo por nodo, así dos personas que mueven elementos
 * distintos del mismo diagrama no generan conflicto. Solo hay conflicto cuando ambos lados
 * cambiaron el mismo campo de forma distinta (o uno lo borró y el otro lo modificó).
 */

export type MergeEntity = 'workspace' | 'element' | 'relation' | 'view' | 'file';
export type ConflictKind = 'both-modified' | 'both-added' | 'modified-deleted' | 'deleted-modified';
export type Resolution = 'ours' | 'theirs';

export interface FieldConflict {
  /** Ruta dentro de la entidad (`['name']`, `['nodes', 'api']`, `['store', 'engine']`). */
  path: string[];
  base?: unknown;
  ours?: unknown;
  theirs?: unknown;
}

export interface MergeConflict {
  key: string;
  entity: MergeEntity;
  id: Id;
  name: string;
  kind: ConflictKind;
  /** Campos en conflicto (vacío en conflictos de borrado). */
  fields: FieldConflict[];
}

export interface MergeResult {
  /** Resultado provisorio: en los conflictos gana "nuestro" hasta que se resuelvan. */
  merged: Model;
  conflicts: MergeConflict[];
  /** Ajustes automáticos de integridad (relaciones o nodos que quedaron colgando). */
  repairs: string[];
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Campos que se mezclan clave por clave (mapas), no como un valor atómico. */
const MAP_FIELDS: Readonly<Record<string, readonly string[]>> = {
  view: ['nodes', 'edges'],
  element: ['store', 'bus', 'group', 'properties', 'extensions'],
  relation: ['properties', 'extensions'],
  workspace: ['extensions'],
};

function mergeValue(
  base: unknown,
  ours: unknown,
  theirs: unknown,
  path: string[],
  mapKeys: readonly string[],
  conflicts: FieldConflict[],
): unknown {
  if (deepEqual(ours, theirs)) return ours;
  if (deepEqual(ours, base)) return theirs;
  if (deepEqual(theirs, base)) return ours;
  const top = path[path.length - 1];
  const mergeAsMap = path.length === 0 || (path.length === 1 && top !== undefined && mapKeys.includes(top));
  if (mergeAsMap && isPlain(ours) && isPlain(theirs)) {
    const b = isPlain(base) ? base : {};
    const out: Record<string, unknown> = {};
    const keys = [...new Set([...Object.keys(b), ...Object.keys(ours), ...Object.keys(theirs)])].sort();
    for (const key of keys) {
      const v = mergeValue(b[key], ours[key], theirs[key], [...path, key], mapKeys, conflicts);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  conflicts.push({ path, base, ours, theirs });
  return ours;
}

function nameOf(entity: MergeEntity, value: unknown, id: Id): string {
  if (entity === 'relation') {
    const r = value as Relation | undefined;
    return r ? `${r.from} → ${r.to}` : id;
  }
  const named = value as { name?: string } | undefined;
  return named?.name ?? id;
}

function mergeRecords<T extends object>(
  entity: MergeEntity,
  base: Readonly<Record<Id, T>>,
  ours: Readonly<Record<Id, T>>,
  theirs: Readonly<Record<Id, T>>,
  conflicts: MergeConflict[],
): Record<Id, T> {
  const out: Record<Id, T> = {};
  const ids = [...new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])].sort();
  const mapKeys = MAP_FIELDS[entity] ?? [];
  for (const id of ids) {
    const b = base[id];
    const o = ours[id];
    const t = theirs[id];
    const key = `${entity}:${id}`;
    if (deepEqual(o, t)) {
      if (o) out[id] = o;
      continue;
    }
    if (deepEqual(o, b)) {
      if (t) out[id] = t;
      continue;
    }
    if (deepEqual(t, b)) {
      if (o) out[id] = o;
      continue;
    }
    if (o && t) {
      const fields: FieldConflict[] = [];
      out[id] = mergeValue(b, o, t, [], mapKeys, fields) as T;
      if (fields.length) conflicts.push({ key, entity, id, name: nameOf(entity, o, id), kind: b ? 'both-modified' : 'both-added', fields });
      continue;
    }
    // Uno lo borró y el otro lo modificó: se conserva la versión modificada hasta resolver.
    out[id] = (o ?? t)!;
    conflicts.push({ key, entity, id, name: nameOf(entity, o ?? t, id), kind: o ? 'modified-deleted' : 'deleted-modified', fields: [] });
  }
  return out;
}

export function mergeModels(base: Model, ours: Model, theirs: Model): MergeResult {
  const conflicts: MergeConflict[] = [];

  const wsFields: FieldConflict[] = [];
  const workspace = mergeValue(base.workspace, ours.workspace, theirs.workspace, [], MAP_FIELDS.workspace!, wsFields) as Model['workspace'];
  if (wsFields.length) {
    conflicts.push({ key: `workspace:${ours.workspace.id}`, entity: 'workspace', id: ours.workspace.id, name: ours.workspace.name, kind: 'both-modified', fields: wsFields });
  }

  const elements = mergeRecords<Element>('element', base.elements, ours.elements, theirs.elements, conflicts);
  const relations = mergeRecords<Relation>('relation', base.relations, ours.relations, theirs.relations, conflicts);
  const views = mergeRecords<View>('view', base.views, ours.views, theirs.views, conflicts);

  const wrap = (m: Model) => Object.fromEntries(Object.entries(m.passthrough ?? {}).map(([p, c]) => [p, { content: c }]));
  const files = mergeRecords<{ content: string }>('file', wrap(base), wrap(ours), wrap(theirs), conflicts);
  const passthrough = Object.fromEntries(Object.entries(files).map(([p, f]) => [p, f.content]));

  const merged: Model = { workspace, elements, relations, views };
  if (Object.keys(passthrough).length) merged.passthrough = passthrough;
  const repaired = repairModel(merged);
  return { merged: repaired.model, conflicts, repairs: repaired.notes };
}

function getPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isPlain(current)) return undefined;
    current = current[key];
  }
  return current;
}

function setPath<T>(value: T, path: readonly string[], next: unknown): T {
  if (!path.length) return next as T;
  const [head, ...rest] = path;
  const obj: Record<string, unknown> = isPlain(value) ? { ...value } : {};
  const child = setPath(obj[head!], rest, next);
  if (child === undefined) delete obj[head!];
  else obj[head!] = child;
  return obj as T;
}

function collectionOf(model: Model, entity: MergeEntity): Record<Id, unknown> | undefined {
  if (entity === 'element') return model.elements as Record<Id, unknown>;
  if (entity === 'relation') return model.relations as Record<Id, unknown>;
  if (entity === 'view') return model.views as Record<Id, unknown>;
  return undefined;
}

/**
 * Aplica las decisiones del usuario sobre un merge con conflictos. En los conflictos de campo
 * solo se reemplazan los campos en disputa (los cambios sin conflicto de ambos lados se
 * conservan); en los de borrado se toma la entidad completa del lado elegido.
 */
export function applyResolutions(
  result: MergeResult,
  ours: Model,
  theirs: Model,
  choices: Readonly<Record<string, Resolution>>,
): { model: Model; repairs: string[] } {
  let model: Model = {
    ...result.merged,
    elements: { ...result.merged.elements },
    relations: { ...result.merged.relations },
    views: { ...result.merged.views },
    ...(result.merged.passthrough ? { passthrough: { ...result.merged.passthrough } } : {}),
  };
  for (const conflict of result.conflicts) {
    const choice = choices[conflict.key] ?? 'ours';
    const source = choice === 'ours' ? ours : theirs;
    if (conflict.entity === 'workspace') {
      let ws = model.workspace;
      for (const f of conflict.fields) ws = setPath(ws, f.path, getPath(source.workspace, f.path));
      model = { ...model, workspace: ws };
      continue;
    }
    if (conflict.entity === 'file') {
      const content = source.passthrough?.[conflict.id];
      const passthrough = { ...(model.passthrough ?? {}) };
      if (content === undefined) delete passthrough[conflict.id];
      else passthrough[conflict.id] = content;
      model = { ...model, passthrough };
      continue;
    }
    const target = collectionOf(model, conflict.entity)!;
    const sourceValue = collectionOf(source, conflict.entity)![conflict.id];
    if (conflict.kind === 'modified-deleted' || conflict.kind === 'deleted-modified') {
      if (sourceValue === undefined) delete target[conflict.id];
      else target[conflict.id] = sourceValue;
      continue;
    }
    let value = target[conflict.id];
    for (const f of conflict.fields) value = setPath(value, f.path, getPath(sourceValue, f.path));
    target[conflict.id] = value;
  }
  const repaired = repairModel(model);
  return { model: repaired.model, repairs: repaired.notes };
}

/**
 * Integridad después de un merge: quita relaciones con extremos inexistentes o repetidas para el
 * mismo par, nodos y estilos de lienzos que apuntan a cosas borradas, lienzos cuyo elemento
 * abierto ya no existe y referencias a grupos o padres borrados.
 */
export function repairModel(model: Model): { model: Model; notes: string[] } {
  const notes: string[] = [];
  const elements: Record<Id, Element> = {};
  for (const [id, el] of Object.entries(model.elements)) {
    let next = el;
    if (el.parent && !model.elements[el.parent]) {
      next = { ...next };
      delete next.parent;
      notes.push(`"${el.name}" perdió su padre "${el.parent}" (borrado del otro lado)`);
    }
    if (el.groups?.some((g) => !model.elements[g])) {
      const groups = el.groups.filter((g) => model.elements[g]);
      next = { ...next, groups };
      if (!groups.length) delete next.groups;
    }
    elements[id] = next;
  }

  const relations: Record<Id, Relation> = {};
  const pairs = new Set<string>();
  for (const rel of Object.values(model.relations).sort((a, b) => a.id.localeCompare(b.id))) {
    if (!elements[rel.from] || !elements[rel.to]) {
      notes.push(`Se quitó la relación "${rel.id}": uno de sus extremos fue borrado`);
      continue;
    }
    const pair = [rel.from, rel.to].sort().join('|');
    if (pairs.has(pair)) {
      notes.push(`Se quitó la relación "${rel.id}": ya hay otra entre los mismos elementos`);
      continue;
    }
    pairs.add(pair);
    relations[rel.id] = rel;
  }

  const views: Record<Id, View> = {};
  for (const [id, view] of Object.entries(model.views)) {
    if (view.scope && !elements[view.scope]) {
      notes.push(`Se quitó el lienzo "${view.name}": su elemento fue borrado`);
      continue;
    }
    const nodes = Object.fromEntries(Object.entries(view.nodes).filter(([n]) => elements[n]));
    const edges = view.edges ? Object.fromEntries(Object.entries(view.edges).filter(([r]) => relations[r])) : undefined;
    const next: View = { ...view, nodes };
    if (edges && Object.keys(edges).length) next.edges = edges;
    else delete next.edges;
    views[id] = next;
  }

  const workspace = { ...model.workspace };
  if (workspace.defaultView && !views[workspace.defaultView]) delete workspace.defaultView;
  const out: Model = { ...model, workspace, elements, relations, views };
  return { model: out, notes };
}
