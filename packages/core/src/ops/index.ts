import { indexOf, descendantsOf, ancestorsOf, type Model } from '../model/index.ts';
import {
  Comment as CommentSchema,
  Element as ElementSchema,
  Flow as FlowSchema,
  Relation as RelationSchema,
  View as ViewSchema,
  WorkspaceMeta as WorkspaceSchema,
  type Comment,
  type EdgeStyle,
  type Element,
  type Flow,
  type Id,
  type NodeLayout,
  type Relation,
  type View,
  type WorkspaceMeta,
} from '../schema/index.ts';
import { canHaveParent } from '../rules/hierarchy.ts';

/** Un patch reemplaza los campos indicados; `null` elimina el campo. */
export type Patch<T> = { [K in keyof T]?: T[K] | null };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type ElementPatch = Patch<DistributiveOmit<Element, 'id' | 'kind'>> & {
  [key: string]: unknown;
};
export type RelationPatch = Patch<Omit<Relation, 'id'>>;
export type ViewPatch = Patch<Pick<View, 'name' | 'description' | 'environment' | 'scope' | 'extensions'>>;
export type WorkspacePatch = Patch<Omit<WorkspaceMeta, 'schema' | 'id'>>;
export type FlowPatch = Patch<Omit<Flow, 'id'>>;
export type CommentPatch = Patch<Omit<Comment, 'id'>>;

/**
 * Toda modificación del modelo es una `Op` serializable a JSON. La misma API la usan la UI,
 * el undo/redo, la lista de cambios y (más adelante) la CLI y el servidor MCP.
 */
export type Op =
  | { type: 'element.add'; element: Element }
  | { type: 'element.update'; id: Id; patch: ElementPatch }
  | { type: 'element.remove'; id: Id }
  | { type: 'relation.add'; relation: Relation }
  | { type: 'relation.update'; id: Id; patch: RelationPatch }
  | { type: 'relation.remove'; id: Id }
  | { type: 'view.add'; view: View }
  | { type: 'view.update'; id: Id; patch: ViewPatch }
  | { type: 'view.remove'; id: Id }
  | { type: 'view.place'; view: Id; nodes: Record<Id, NodeLayout> }
  | { type: 'view.unplace'; view: Id; ids: Id[] }
  | { type: 'view.edge'; view: Id; relation: Id; style: EdgeStyle | null }
  | { type: 'workspace.update'; patch: WorkspacePatch }
  | { type: 'flow.add'; flow: Flow }
  | { type: 'flow.update'; id: Id; patch: FlowPatch }
  | { type: 'flow.remove'; id: Id }
  | { type: 'comment.add'; comment: Comment }
  | { type: 'comment.update'; id: Id; patch: CommentPatch }
  | { type: 'comment.remove'; id: Id }
  | { type: 'batch'; ops: Op[]; label?: string };

export type OpType = Op['type'];

export interface ApplyResult {
  model: Model;
  /** Operación que deshace exactamente este cambio. */
  inverse: Op;
}

export class OpError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'OpError';
    this.code = code;
  }
}

export function batch(ops: Op[], label?: string): Op {
  if (ops.length === 1 && !label) return ops[0]!;
  return label ? { type: 'batch', ops, label } : { type: 'batch', ops };
}

/** Aplica una operación de forma pura. Lanza `OpError` si la operación es inválida. */
export function applyOp(model: Model, op: Op): ApplyResult {
  switch (op.type) {
    case 'element.add':
      return addElement(model, op.element);
    case 'element.update':
      return updateElement(model, op.id, op.patch);
    case 'element.remove':
      return removeElement(model, op.id);
    case 'relation.add':
      return addRelation(model, op.relation);
    case 'relation.update':
      return updateRelation(model, op.id, op.patch);
    case 'relation.remove':
      return removeRelation(model, op.id);
    case 'view.add':
      return addView(model, op.view);
    case 'view.update':
      return updateView(model, op.id, op.patch);
    case 'view.remove':
      return removeView(model, op.id);
    case 'view.place':
      return placeNodes(model, op.view, op.nodes);
    case 'view.unplace':
      return unplaceNodes(model, op.view, op.ids);
    case 'view.edge':
      return setEdgeStyle(model, op.view, op.relation, op.style);
    case 'workspace.update':
      return updateWorkspace(model, op.patch);
    case 'flow.add':
      return addEntry(model, 'flows', op.flow, FlowSchema, 'flow');
    case 'flow.update':
      return updateEntry(model, 'flows', op.id, op.patch, FlowSchema, 'flow');
    case 'flow.remove':
      return removeEntry(model, 'flows', op.id, 'flow');
    case 'comment.add':
      return addEntry(model, 'comments', op.comment, CommentSchema, 'comment');
    case 'comment.update':
      return updateEntry(model, 'comments', op.id, op.patch, CommentSchema, 'comment');
    case 'comment.remove':
      return removeEntry(model, 'comments', op.id, 'comment');
    case 'batch':
      return applyBatch(model, op.ops, op.label);
  }
}

/** Aplica una lista de operaciones en orden. */
export function applyOps(model: Model, ops: readonly Op[]): ApplyResult {
  return applyBatch(model, ops);
}

function applyBatch(model: Model, ops: readonly Op[], label?: string): ApplyResult {
  let current = model;
  const inverses: Op[] = [];
  for (const op of ops) {
    const result = applyOp(current, op);
    current = result.model;
    inverses.push(result.inverse);
  }
  inverses.reverse();
  return { model: current, inverse: label ? { type: 'batch', ops: inverses, label } : { type: 'batch', ops: inverses } };
}

// ---------------------------------------------------------------------------------------------
// Helpers

function applyPatch<T extends object>(target: T, patch: object): T {
  const next: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as T;
}

/** Patch inverso: valores previos de cada clave tocada (`null` si no existía). */
function inversePatch(target: object, patch: object): Record<string, unknown> {
  const prev: Record<string, unknown> = {};
  const source = target as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    prev[key] = key in source && source[key] !== undefined ? source[key] : null;
  }
  return prev;
}

function setRecord<T>(record: Readonly<Record<Id, T>>, id: Id, value: T): Record<Id, T> {
  return { ...record, [id]: value };
}

function deleteRecord<T>(record: Readonly<Record<Id, T>>, id: Id): Record<Id, T> {
  const next = { ...record };
  delete next[id];
  return next;
}

function formatIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
    .join('; ');
}

function parseElement(element: unknown): Element {
  const parsed = ElementSchema.safeParse(element);
  if (!parsed.success) throw new OpError('invalid-element', formatIssues(parsed.error));
  return parsed.data;
}

function checkElementRefs(model: Model, el: Element) {
  if (el.parent !== undefined) {
    if (el.parent === el.id) throw new OpError('invalid-parent', `"${el.id}" no puede ser su propio padre`);
    const parent = model.elements[el.parent];
    if (!parent) throw new OpError('missing-parent', `No existe el padre "${el.parent}"`);
    if (!canHaveParent(el.kind, parent.kind)) {
      throw new OpError(
        'invalid-parent',
        `Un ${el.kind} no puede estar dentro de un ${parent.kind}`,
      );
    }
    if (ancestorsOf(model, parent.id).some((a) => a.id === el.id)) {
      throw new OpError('parent-cycle', `Mover "${el.id}" dentro de "${parent.id}" crea un ciclo`);
    }
  }
  for (const groupId of el.groups ?? []) {
    const group = model.elements[groupId];
    if (!group) throw new OpError('missing-group', `No existe el grupo "${groupId}"`);
    if (group.kind !== 'group') throw new OpError('invalid-group', `"${groupId}" no es un grupo`);
    if (groupId === el.id) throw new OpError('invalid-group', `"${el.id}" no puede contenerse`);
  }
}

// ---------------------------------------------------------------------------------------------
// Elementos

function addElement(model: Model, input: Element): ApplyResult {
  const el = parseElement(input);
  if (model.elements[el.id]) throw new OpError('duplicate-id', `Ya existe un elemento "${el.id}"`);
  checkElementRefs(model, el);
  return {
    model: { ...model, elements: setRecord(model.elements, el.id, el) },
    inverse: { type: 'element.remove', id: el.id },
  };
}

function updateElement(model: Model, id: Id, patch: ElementPatch): ApplyResult {
  const current = model.elements[id];
  if (!current) throw new OpError('not-found', `No existe el elemento "${id}"`);
  if ('id' in patch || 'kind' in patch) {
    throw new OpError('immutable-field', 'No se puede cambiar el ID ni el tipo de un elemento');
  }
  const next = parseElement(applyPatch(current, patch));
  checkElementRefs(model, next);
  return {
    model: { ...model, elements: setRecord(model.elements, id, next) },
    inverse: { type: 'element.update', id, patch: inversePatch(current, patch) as ElementPatch },
  };
}

function removeElement(model: Model, id: Id): ApplyResult {
  if (!model.elements[id]) throw new OpError('not-found', `No existe el elemento "${id}"`);
  const targets = [id, ...descendantsOf(model, id)];
  const targetSet = new Set(targets);
  const idx = indexOf(model);

  // 1. Expandir la cascada en operaciones primitivas (cada una con su inversa).
  const steps: Op[] = [];
  const relationIds = new Set<Id>();
  for (const t of targets) {
    for (const r of idx.relationsFrom.get(t) ?? []) relationIds.add(r);
    for (const r of idx.relationsTo.get(t) ?? []) relationIds.add(r);
  }
  for (const r of [...relationIds].sort()) steps.push({ type: 'relation.remove', id: r });

  const removedViews = new Set<Id>();
  for (const t of targets) {
    for (const v of idx.viewsByScope.get(t) ?? []) removedViews.add(v);
  }
  for (const v of [...removedViews].sort()) steps.push({ type: 'view.remove', id: v });

  const unplaceByView = new Map<Id, Id[]>();
  for (const t of targets) {
    for (const v of idx.viewsContaining.get(t) ?? []) {
      if (removedViews.has(v)) continue;
      const list = unplaceByView.get(v) ?? [];
      list.push(t);
      unplaceByView.set(v, list);
    }
  }
  for (const [v, ids] of [...unplaceByView].sort(([a], [b]) => a.localeCompare(b))) {
    steps.push({ type: 'view.unplace', view: v, ids });
  }

  for (const t of targets) {
    for (const member of idx.membersOf.get(t) ?? []) {
      if (targetSet.has(member)) continue;
      const el = model.elements[member]!;
      const groups = (el.groups ?? []).filter((g) => !targetSet.has(g));
      steps.push({ type: 'element.update', id: member, patch: { groups: groups.length ? groups : null } });
    }
  }

  let current = model;
  const inverses: Op[] = [];
  for (const step of steps) {
    const result = applyOp(current, step);
    current = result.model;
    inverses.push(result.inverse);
  }

  // 2. Quitar los elementos de hojas a raíz.
  for (const t of [...targets].reverse()) {
    const el = current.elements[t]!;
    current = { ...current, elements: deleteRecord(current.elements, t) };
    inverses.push({ type: 'element.add', element: el });
  }

  inverses.reverse();
  return { model: current, inverse: { type: 'batch', ops: inverses } };
}

// ---------------------------------------------------------------------------------------------
// Relaciones

function parseRelation(input: unknown): Relation {
  const parsed = RelationSchema.safeParse(input);
  if (!parsed.success) throw new OpError('invalid-relation', formatIssues(parsed.error));
  return parsed.data;
}

function checkRelationRefs(model: Model, rel: Relation) {
  for (const end of [rel.from, rel.to]) {
    if (!model.elements[end]) throw new OpError('missing-endpoint', `No existe el elemento "${end}"`);
  }
  if (model.elements[rel.from]!.kind === 'group' || model.elements[rel.to]!.kind === 'group') {
    throw new OpError('invalid-endpoint', 'Los grupos no pueden tener relaciones');
  }
}

function checkUniquePair(model: Model, rel: Relation) {
  if (rel.from === rel.to) throw new OpError('self-relation', 'Un elemento no puede relacionarse consigo mismo');
  const idx = indexOf(model);
  const clash = [...(idx.relationsFrom.get(rel.from) ?? []), ...(idx.relationsFrom.get(rel.to) ?? [])]
    .map((id) => model.relations[id]!)
    .find((r) => r.id !== rel.id && ((r.from === rel.from && r.to === rel.to) || (r.from === rel.to && r.to === rel.from)));
  if (clash) {
    const a = model.elements[rel.from]?.name ?? rel.from;
    const b = model.elements[rel.to]?.name ?? rel.to;
    throw new OpError('duplicate-relation', `"${a}" y "${b}" ya están conectados: en C4 hay una sola relación por par`);
  }
}

function addRelation(model: Model, input: Relation): ApplyResult {
  const rel = parseRelation(input);
  if (model.relations[rel.id]) throw new OpError('duplicate-id', `Ya existe la relación "${rel.id}"`);
  checkRelationRefs(model, rel);
  checkUniquePair(model, rel);
  return {
    model: { ...model, relations: setRecord(model.relations, rel.id, rel) },
    inverse: { type: 'relation.remove', id: rel.id },
  };
}

function updateRelation(model: Model, id: Id, patch: RelationPatch): ApplyResult {
  const current = model.relations[id];
  if (!current) throw new OpError('not-found', `No existe la relación "${id}"`);
  if ('id' in patch) throw new OpError('immutable-field', 'No se puede cambiar el ID de una relación');
  const next = parseRelation(applyPatch(current, patch));
  checkRelationRefs(model, next);
  if (next.from !== current.from || next.to !== current.to) checkUniquePair(model, next);
  return {
    model: { ...model, relations: setRecord(model.relations, id, next) },
    inverse: { type: 'relation.update', id, patch: inversePatch(current, patch) as RelationPatch },
  };
}

function removeRelation(model: Model, id: Id): ApplyResult {
  const rel = model.relations[id];
  if (!rel) throw new OpError('not-found', `No existe la relación "${id}"`);
  const inverses: Op[] = [{ type: 'relation.add', relation: rel }];
  let views = model.views;
  for (const view of Object.values(model.views)) {
    const style = view.edges?.[id];
    if (!style) continue;
    const edges = deleteRecord(view.edges!, id);
    const nextView: View = { ...view, edges: Object.keys(edges).length ? edges : undefined };
    if (!nextView.edges) delete nextView.edges;
    views = setRecord(views, view.id, nextView);
    inverses.push({ type: 'view.edge', view: view.id, relation: id, style });
  }
  return {
    model: { ...model, relations: deleteRecord(model.relations, id), views },
    inverse: batch(inverses),
  };
}

// ---------------------------------------------------------------------------------------------
// Vistas

function parseView(input: unknown): View {
  const parsed = ViewSchema.safeParse(input);
  if (!parsed.success) throw new OpError('invalid-view', formatIssues(parsed.error));
  return parsed.data;
}

function getView(model: Model, id: Id): View {
  const view = model.views[id];
  if (!view) throw new OpError('not-found', `No existe el lienzo "${id}"`);
  return view;
}

function addView(model: Model, input: View): ApplyResult {
  const view = parseView(input);
  if (model.views[view.id]) throw new OpError('duplicate-id', `Ya existe el lienzo "${view.id}"`);
  if (view.scope && !model.elements[view.scope]) {
    throw new OpError('missing-scope', `No existe el elemento "${view.scope}"`);
  }
  for (const nodeId of Object.keys(view.nodes)) {
    if (!model.elements[nodeId]) throw new OpError('missing-node', `No existe el elemento "${nodeId}"`);
  }
  return {
    model: { ...model, views: setRecord(model.views, view.id, view) },
    inverse: { type: 'view.remove', id: view.id },
  };
}

function updateView(model: Model, id: Id, patch: ViewPatch): ApplyResult {
  const current = getView(model, id);
  for (const key of Object.keys(patch)) {
    if (!['name', 'description', 'environment', 'scope', 'extensions'].includes(key)) {
      throw new OpError('immutable-field', `"${key}" no se puede cambiar con view.update`);
    }
    // El elemento abierto define un L2/L3; en despliegue es solo un filtro y se puede cambiar.
    if ((key === 'environment' || key === 'scope') && current.level !== 'deployment') {
      throw new OpError('invalid-view', key === 'environment' ? 'Solo los lienzos de despliegue tienen ambiente' : 'El elemento que abre un lienzo L2/L3 no se puede cambiar');
    }
  }
  const next = parseView(applyPatch(current, patch));
  return {
    model: { ...model, views: setRecord(model.views, id, next) },
    inverse: { type: 'view.update', id, patch: inversePatch(current, patch) as ViewPatch },
  };
}

function removeView(model: Model, id: Id): ApplyResult {
  const view = getView(model, id);
  let workspace = model.workspace;
  const inverses: Op[] = [{ type: 'view.add', view }];
  if (workspace.defaultView === id) {
    workspace = { ...workspace };
    delete workspace.defaultView;
    inverses.push({ type: 'workspace.update', patch: { defaultView: id } });
  }
  return {
    model: { ...model, workspace, views: deleteRecord(model.views, id) },
    inverse: batch(inverses),
  };
}

function placeNodes(model: Model, viewId: Id, nodes: Record<Id, NodeLayout>): ApplyResult {
  const view = getView(model, viewId);
  const nextNodes = { ...view.nodes };
  const restore: Record<Id, NodeLayout> = {};
  const added: Id[] = [];
  for (const [id, layout] of Object.entries(nodes)) {
    if (!model.elements[id]) throw new OpError('missing-node', `No existe el elemento "${id}"`);
    if (!Number.isFinite(layout.x) || !Number.isFinite(layout.y)) {
      throw new OpError('invalid-layout', `Posición inválida para "${id}"`);
    }
    const prev = view.nodes[id];
    if (prev) restore[id] = prev;
    else added.push(id);
    nextNodes[id] = cleanLayout(layout);
  }
  const inverses: Op[] = [];
  if (added.length) inverses.push({ type: 'view.unplace', view: viewId, ids: added });
  if (Object.keys(restore).length) inverses.push({ type: 'view.place', view: viewId, nodes: restore });
  return {
    model: { ...model, views: setRecord(model.views, viewId, { ...view, nodes: nextNodes }) },
    inverse: batch(inverses),
  };
}

function cleanLayout(layout: NodeLayout): NodeLayout {
  const out: NodeLayout = { x: round(layout.x), y: round(layout.y) };
  if (layout.w !== undefined) out.w = round(layout.w);
  if (layout.h !== undefined) out.h = round(layout.h);
  return out;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function unplaceNodes(model: Model, viewId: Id, ids: Id[]): ApplyResult {
  const view = getView(model, viewId);
  const nextNodes = { ...view.nodes };
  const restore: Record<Id, NodeLayout> = {};
  for (const id of ids) {
    const prev = view.nodes[id];
    if (!prev) continue;
    restore[id] = prev;
    delete nextNodes[id];
  }
  return {
    model: { ...model, views: setRecord(model.views, viewId, { ...view, nodes: nextNodes }) },
    inverse: { type: 'view.place', view: viewId, nodes: restore },
  };
}

function setEdgeStyle(model: Model, viewId: Id, relationId: Id, style: EdgeStyle | null): ApplyResult {
  const view = getView(model, viewId);
  const prev = view.edges?.[relationId] ?? null;
  let edges: Record<Id, EdgeStyle> | undefined;
  if (style && Object.keys(style).length) edges = { ...(view.edges ?? {}), [relationId]: style };
  else {
    edges = { ...(view.edges ?? {}) };
    delete edges[relationId];
  }
  const nextView: View = { ...view, edges };
  if (!Object.keys(edges).length) delete nextView.edges;
  return {
    model: { ...model, views: setRecord(model.views, viewId, nextView) },
    inverse: { type: 'view.edge', view: viewId, relation: relationId, style: prev },
  };
}

// ---------------------------------------------------------------------------------------------
// Workspace

function updateWorkspace(model: Model, patch: WorkspacePatch): ApplyResult {
  if ('schema' in patch || 'id' in patch) {
    throw new OpError('immutable-field', 'No se puede cambiar el ID ni la versión del workspace');
  }
  const parsed = WorkspaceSchema.safeParse(applyPatch(model.workspace, patch));
  if (!parsed.success) throw new OpError('invalid-workspace', formatIssues(parsed.error));
  if (parsed.data.defaultView && !model.views[parsed.data.defaultView]) {
    throw new OpError('missing-view', `No existe el lienzo "${parsed.data.defaultView}"`);
  }
  return {
    model: { ...model, workspace: parsed.data },
    inverse: {
      type: 'workspace.update',
      patch: inversePatch(model.workspace, patch) as WorkspacePatch,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Flujos y comentarios: colecciones simples (sin cascadas). Las referencias colgantes a elementos
// o lienzos borrados no bloquean la edición: las reporta `validateModel`.

type Collection = 'flows' | 'comments';
type Entry<C extends Collection> = C extends 'flows' ? Flow : Comment;
const ENTRY_LABEL = { flow: 'el flujo', comment: 'el comentario' } as const;

/** Reemplaza una colección opcional del modelo (sin la clave si queda vacía). */
function withCollection<C extends Collection>(model: Model, key: C, next: Record<Id, Entry<C>>): Model {
  const out: Record<string, unknown> = { ...model };
  if (Object.keys(next).length) out[key] = next;
  else delete out[key];
  return out as unknown as Model;
}

function addEntry<C extends Collection>(
  model: Model,
  key: C,
  entry: Entry<C>,
  schema: { safeParse(v: unknown): { success: true; data: unknown } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } },
  kind: 'flow' | 'comment',
): ApplyResult {
  const parsed = schema.safeParse(entry);
  if (!parsed.success) throw new OpError(`invalid-${kind}`, formatIssues(parsed.error));
  const value = parsed.data as Entry<C>;
  const current = (model[key] ?? {}) as Record<Id, Entry<C>>;
  if (current[value.id]) throw new OpError('duplicate-id', `Ya existe ${ENTRY_LABEL[kind]} "${value.id}"`);
  return {
    model: withCollection(model, key, { ...current, [value.id]: value }),
    inverse: { type: `${kind}.remove`, id: value.id } as Op,
  };
}

function updateEntry<C extends Collection>(
  model: Model,
  key: C,
  id: Id,
  patch: object,
  schema: { safeParse(v: unknown): { success: true; data: unknown } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } },
  kind: 'flow' | 'comment',
): ApplyResult {
  const current = (model[key] ?? {}) as Record<Id, Entry<C>>;
  const prev = current[id];
  if (!prev) throw new OpError('not-found', `No existe ${ENTRY_LABEL[kind]} "${id}"`);
  if ('id' in patch) throw new OpError('immutable-field', 'No se puede cambiar el ID');
  const parsed = schema.safeParse(applyPatch(prev, patch));
  if (!parsed.success) throw new OpError(`invalid-${kind}`, formatIssues(parsed.error));
  return {
    model: withCollection(model, key, { ...current, [id]: parsed.data as Entry<C> }),
    inverse: { type: `${kind}.update`, id, patch: inversePatch(prev, patch) } as Op,
  };
}

function removeEntry<C extends Collection>(model: Model, key: C, id: Id, kind: 'flow' | 'comment'): ApplyResult {
  const current = (model[key] ?? {}) as Record<Id, Entry<C>>;
  const prev = current[id];
  if (!prev) throw new OpError('not-found', `No existe ${ENTRY_LABEL[kind]} "${id}"`);
  const next = { ...current };
  delete next[id];
  return {
    model: withCollection(model, key, next),
    inverse: (kind === 'flow' ? { type: 'flow.add', flow: prev } : { type: 'comment.add', comment: prev }) as Op,
  };
}

/** True si la operación no tiene efecto (ej. un batch vacío). */
export function isNoop(op: Op): boolean {
  if (op.type === 'batch') return op.ops.every(isNoop);
  if (op.type === 'view.place') return Object.keys(op.nodes).length === 0;
  if (op.type === 'view.unplace') return op.ids.length === 0;
  if (op.type === 'element.update' || op.type === 'relation.update' || op.type === 'view.update' || op.type === 'flow.update' || op.type === 'comment.update') {
    return Object.keys(op.patch).length === 0;
  }
  return false;
}

export * from './commands.ts';
