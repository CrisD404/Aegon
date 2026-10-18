import { ancestorsOf, indexOf, type Model } from '../model/index.ts';
import type { Comment, Element, ElementKind, Flow, Id, NodeLayout, Relation, View } from '../schema/index.ts';
import { KIND_LABEL } from '../ops/commands.ts';
import type { Op } from '../ops/index.ts';

/**
 * Diff semántico entre dos modelos. Compara por entidad (no por archivo ni por historial de
 * operaciones), así "agregado y luego eliminado" no aparece como cambio.
 */

export type EntityType = 'workspace' | 'element' | 'relation' | 'view' | 'flow' | 'comment';
export type ChangeKind = 'added' | 'removed' | 'modified';

export interface FieldChange {
  path: string;
  before?: unknown;
  after?: unknown;
}

export interface LayoutSummary {
  added: number;
  removed: number;
  moved: number;
}

export interface Change {
  /** Clave estable: `element:payments-api`. */
  key: string;
  entity: EntityType;
  id: Id;
  kind: ChangeKind;
  /** Nombre para mostrar (el actual, o el previo si se eliminó). */
  name: string;
  elementKind?: ElementKind;
  fields: FieldChange[];
  layout?: LayoutSummary;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bArr = b as unknown[];
    return a.length === bArr.length && a.every((v, i) => deepEqual(v, bArr[i]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
  for (const key of keys) {
    if (aObj[key] === undefined && bObj[key] === undefined) continue;
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }
  return true;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function diffFields(before: object, after: object, prefix = '', skip: readonly string[] = []): FieldChange[] {
  const out: FieldChange[] = [];
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  for (const key of keys) {
    if (skip.includes(key)) continue;
    const bv = b[key];
    const av = a[key];
    if (deepEqual(bv, av)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(bv) && isPlainObject(av) && !prefix) {
      out.push(...diffFields(bv, av, path));
    } else {
      const change: FieldChange = { path };
      if (bv !== undefined) change.before = bv;
      if (av !== undefined) change.after = av;
      out.push(change);
    }
  }
  return out;
}

function diffRecords<T extends { id: Id }>(
  entity: EntityType,
  base: Readonly<Record<Id, T>>,
  current: Readonly<Record<Id, T>>,
  nameOf: (item: T, model: 'base' | 'current') => string,
  extra?: (item: T) => Partial<Change>,
): Change[] {
  const out: Change[] = [];
  if (base === current) return out;
  for (const [id, item] of Object.entries(current)) {
    const prev = base[id];
    if (!prev) {
      out.push({ key: `${entity}:${id}`, entity, id, kind: 'added', name: nameOf(item, 'current'), fields: [], ...extra?.(item) });
    } else if (prev !== item && !deepEqual(prev, item)) {
      const fields = diffFields(prev, item);
      if (fields.length) {
        out.push({ key: `${entity}:${id}`, entity, id, kind: 'modified', name: nameOf(item, 'current'), fields, ...extra?.(item) });
      }
    }
  }
  for (const [id, item] of Object.entries(base)) {
    if (!current[id]) {
      out.push({ key: `${entity}:${id}`, entity, id, kind: 'removed', name: nameOf(item, 'base'), fields: [], ...extra?.(item) });
    }
  }
  return out;
}

function layoutSummary(before: View, after: View): LayoutSummary {
  let added = 0;
  let removed = 0;
  let moved = 0;
  for (const [id, layout] of Object.entries(after.nodes)) {
    const prev = before.nodes[id];
    if (!prev) added++;
    else if (!deepEqual(prev, layout)) moved++;
  }
  for (const id of Object.keys(before.nodes)) if (!after.nodes[id]) removed++;
  return { added, removed, moved };
}

const KIND_ORDER: Record<ChangeKind, number> = { added: 0, modified: 1, removed: 2 };
const ENTITY_ORDER: Record<EntityType, number> = { workspace: 0, element: 1, relation: 2, view: 3, flow: 4, comment: 5 };
const EMPTY: Readonly<Record<Id, never>> = Object.freeze({});

/** Nombre corto de un comentario: su título o el comienzo del texto. */
export function commentLabel(comment: Comment): string {
  if (comment.title) return comment.title;
  const text = comment.body.replace(/\s+/g, ' ').trim();
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

export function diffModels(base: Model, current: Model): Change[] {
  const out: Change[] = [];
  if (base === current) return out;

  if (!deepEqual(base.workspace, current.workspace)) {
    out.push({
      key: `workspace:${current.workspace.id}`,
      entity: 'workspace',
      id: current.workspace.id,
      kind: 'modified',
      name: current.workspace.name,
      fields: diffFields(base.workspace, current.workspace),
    });
  }

  out.push(
    ...diffRecords<Element>('element', base.elements, current.elements, (e) => e.name, (e) => ({ elementKind: e.kind })),
  );

  const relName = (r: Relation, which: 'base' | 'current') => {
    const m = which === 'base' ? base : current;
    const from = m.elements[r.from]?.name ?? r.from;
    const to = m.elements[r.to]?.name ?? r.to;
    return `${from} → ${to}`;
  };
  out.push(...diffRecords<Relation>('relation', base.relations, current.relations, relName));

  if (base.views !== current.views) {
    for (const change of diffRecords<View>('view', base.views, current.views, (v) => v.name)) {
      if (change.kind === 'modified') {
        const before = base.views[change.id]!;
        const after = current.views[change.id]!;
        change.layout = layoutSummary(before, after);
        change.fields = diffFields(before, after, '', ['nodes', 'edges']);
        if (!deepEqual(before.edges ?? {}, after.edges ?? {})) {
          change.fields.push({ path: 'edges', before: before.edges, after: after.edges });
        }
      }
      out.push(change);
    }
  }

  out.push(...diffRecords<Flow>('flow', base.flows ?? EMPTY, current.flows ?? EMPTY, (f) => f.name));
  out.push(...diffRecords<Comment>('comment', base.comments ?? EMPTY, current.comments ?? EMPTY, commentLabel));

  return out.sort(
    (a, b) =>
      ENTITY_ORDER[a.entity] - ENTITY_ORDER[b.entity] ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

// ---------------------------------------------------------------------------------------------
// Resúmenes legibles

const VERB: Record<ChangeKind, string> = { added: 'Agregar', modified: 'Actualizar', removed: 'Eliminar' };

function layoutText(l: LayoutSummary): string {
  const parts: string[] = [];
  if (l.moved) parts.push(`${l.moved} ${l.moved === 1 ? 'nodo movido' : 'nodos movidos'}`);
  if (l.added) parts.push(`${l.added} ${l.added === 1 ? 'nodo ubicado' : 'nodos ubicados'}`);
  if (l.removed) parts.push(`${l.removed} ${l.removed === 1 ? 'nodo quitado' : 'nodos quitados'}`);
  return parts.join(', ');
}

export function entityLabel(change: Change): string {
  if (change.entity === 'element') return KIND_LABEL[change.elementKind ?? 'system'];
  if (change.entity === 'relation') return 'Relación';
  if (change.entity === 'view') return 'Lienzo';
  if (change.entity === 'flow') return 'Flujo';
  if (change.entity === 'comment') return 'Comentario';
  return 'Workspace';
}

/** Una línea: `Actualizar Payments API (name, risk)`. */
export function summarizeChange(change: Change): string {
  if (change.entity === 'view' && change.kind === 'modified') {
    const parts = [layoutText(change.layout ?? { added: 0, moved: 0, removed: 0 })];
    for (const f of change.fields) parts.push(f.path === 'edges' ? 'estilos de relaciones' : f.path);
    return `Lienzo ${change.name}: ${parts.filter(Boolean).join(', ')}`;
  }
  const fields =
    change.kind === 'modified' && change.fields.length
      ? ` (${[...new Set(change.fields.map((f) => f.path.split('.')[0]))].join(', ')})`
      : '';
  return `${VERB[change.kind]} ${entityLabel(change).toLowerCase()} ${change.name}${fields}`;
}

/** Mensaje de commit autogenerado: título corto + cuerpo con todos los cambios. */
export function commitMessage(changes: readonly Change[]): string {
  if (!changes.length) return 'Sin cambios';
  const lines = changes.map(summarizeChange);
  if (changes.length === 1) return lines[0]!;
  const head = lines.slice(0, 2).join(', ');
  const more = changes.length > 2 ? `, +${changes.length - 2}` : '';
  return `${changes.length} cambios — ${head}${more}\n\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

// ---------------------------------------------------------------------------------------------
// Revertir

function patchToBase(before: object | undefined, after: object): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const b = (before ?? {}) as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === 'id' || key === 'kind') continue;
    if (!deepEqual(a[key], b[key])) patch[key] = b[key] === undefined ? null : b[key];
  }
  return patch;
}

function restoreElementOps(base: Model, current: Model, id: Id, restored: Set<Id>): Op[] {
  const el = base.elements[id];
  if (!el || current.elements[id] || restored.has(id)) return [];
  const ops: Op[] = [];
  // Restaurar primero los ancestros eliminados.
  for (const ancestor of ancestorsOf(base, id).reverse()) {
    if (!current.elements[ancestor.id] && !restored.has(ancestor.id)) {
      ops.push(...restoreElementOps(base, current, ancestor.id, restored));
    }
  }
  restored.add(id);
  const element = { ...el } as Element;
  const groups = (el.groups ?? []).filter((g) => current.elements[g] || restored.has(g));
  if (groups.length) element.groups = groups;
  else delete element.groups;
  ops.push({ type: 'element.add', element });
  return ops;
}

/** Op que deshace un cambio puntual del diff (lo devuelve a su estado en `base`). */
export function revertChangeOp(base: Model, current: Model, change: Change): Op | null {
  const { id } = change;
  switch (change.entity) {
    case 'workspace': {
      const patch = patchToBase(base.workspace, current.workspace);
      delete patch.schema;
      return { type: 'workspace.update', patch };
    }
    case 'element': {
      if (change.kind === 'added') return { type: 'element.remove', id };
      if (change.kind === 'modified') {
        return { type: 'element.update', id, patch: patchToBase(base.elements[id], current.elements[id]!) };
      }
      const restored = new Set<Id>();
      const ops = restoreElementOps(base, current, id, restored);
      const exists = (e: Id) => !!current.elements[e] || restored.has(e);
      for (const relId of [...(indexOf(base).relationsFrom.get(id) ?? []), ...(indexOf(base).relationsTo.get(id) ?? [])]) {
        const rel = base.relations[relId]!;
        if (!current.relations[relId] && exists(rel.from) && exists(rel.to)) {
          ops.push({ type: 'relation.add', relation: rel });
        }
      }
      for (const restoredId of restored) {
        for (const viewId of indexOf(base).viewsContaining.get(restoredId) ?? []) {
          const layout = base.views[viewId]?.nodes[restoredId];
          if (layout && current.views[viewId]) {
            ops.push({ type: 'view.place', view: viewId, nodes: { [restoredId]: layout } });
          }
        }
      }
      return { type: 'batch', ops, label: `Restaurar ${change.name}` };
    }
    case 'relation': {
      if (change.kind === 'added') return { type: 'relation.remove', id };
      if (change.kind === 'removed') return { type: 'relation.add', relation: base.relations[id]! };
      return {
        type: 'relation.update',
        id,
        patch: patchToBase(base.relations[id], current.relations[id]!),
      };
    }
    case 'view': {
      if (change.kind === 'added') return { type: 'view.remove', id };
      const baseView = base.views[id]!;
      const nodes: Record<Id, NodeLayout> = {};
      for (const [nodeId, layout] of Object.entries(baseView.nodes)) {
        if (current.elements[nodeId]) nodes[nodeId] = layout;
      }
      if (change.kind === 'removed') {
        if (baseView.scope && !current.elements[baseView.scope]) return null;
        return { type: 'view.add', view: { ...baseView, nodes } };
      }
      const currentView = current.views[id]!;
      const ops: Op[] = [];
      const meta = patchToBase(
        { name: baseView.name, description: baseView.description },
        { name: currentView.name, description: currentView.description },
      );
      if (Object.keys(meta).length) ops.push({ type: 'view.update', id, patch: meta });
      const unplace = Object.keys(currentView.nodes).filter((n) => !baseView.nodes[n]);
      if (unplace.length) ops.push({ type: 'view.unplace', view: id, ids: unplace });
      const place: Record<Id, NodeLayout> = {};
      for (const [nodeId, layout] of Object.entries(nodes)) {
        if (!deepEqual(currentView.nodes[nodeId], layout)) place[nodeId] = layout;
      }
      if (Object.keys(place).length) ops.push({ type: 'view.place', view: id, nodes: place });
      const relIds = new Set([...Object.keys(baseView.edges ?? {}), ...Object.keys(currentView.edges ?? {})]);
      for (const relId of relIds) {
        const before = baseView.edges?.[relId] ?? null;
        if (!deepEqual(before, currentView.edges?.[relId] ?? null)) {
          ops.push({ type: 'view.edge', view: id, relation: relId, style: before });
        }
      }
      return { type: 'batch', ops, label: `Restaurar lienzo ${change.name}` };
    }
    case 'flow': {
      if (change.kind === 'added') return { type: 'flow.remove', id };
      if (change.kind === 'removed') return { type: 'flow.add', flow: base.flows![id]! };
      return { type: 'flow.update', id, patch: patchToBase(base.flows![id], current.flows![id]!) };
    }
    case 'comment': {
      if (change.kind === 'added') return { type: 'comment.remove', id };
      if (change.kind === 'removed') return { type: 'comment.add', comment: base.comments![id]! };
      return { type: 'comment.update', id, patch: patchToBase(base.comments![id], current.comments![id]!) };
    }
  }
}
