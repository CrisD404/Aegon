import type { Comment, Element, ElementKind, Flow, Id, Relation, View, WorkspaceMeta } from '../schema/index.ts';
import { SCHEMA_VERSION } from '../schema/index.ts';
import { levelRank } from '../rules/hierarchy.ts';

/**
 * Modelo en memoria de un workspace. Es inmutable: cada operación devuelve un modelo nuevo
 * compartiendo las partes que no cambiaron, así React y el diff pueden comparar por referencia.
 */
export interface Model {
  workspace: WorkspaceMeta;
  elements: Readonly<Record<Id, Element>>;
  relations: Readonly<Record<Id, Relation>>;
  views: Readonly<Record<Id, View>>;
  /** Flujos (secuencias de pasos). Opcional: sin flujos el campo no está. */
  flows?: Readonly<Record<Id, Flow>>;
  /** Comentarios sobre los lienzos. Opcional como `flows`. */
  comments?: Readonly<Record<Id, Comment>>;
  /**
   * Archivos que Aegon conserva sin interpretar (ej. `attachments/`).
   * Clave: ruta relativa POSIX.
   */
  passthrough?: Readonly<Record<string, string>>;
}

export function emptyModel(id: Id, name: string): Model {
  return {
    workspace: { schema: SCHEMA_VERSION, id, name },
    elements: {},
    relations: {},
    views: {},
  };
}

export interface ModelIndex {
  childrenOf: ReadonlyMap<Id | null, readonly Id[]>;
  membersOf: ReadonlyMap<Id, readonly Id[]>;
  relationsFrom: ReadonlyMap<Id, readonly Id[]>;
  relationsTo: ReadonlyMap<Id, readonly Id[]>;
  viewsByScope: ReadonlyMap<Id, readonly Id[]>;
  viewsContaining: ReadonlyMap<Id, readonly Id[]>;
}

const indexCache = new WeakMap<Model, ModelIndex>();
const elementIndexCache = new WeakMap<object, Pick<ModelIndex, 'childrenOf' | 'membersOf'>>();
const relationIndexCache = new WeakMap<
  object,
  Pick<ModelIndex, 'relationsFrom' | 'relationsTo'>
>();
const viewIndexCache = new WeakMap<object, Pick<ModelIndex, 'viewsByScope' | 'viewsContaining'>>();

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Índices derivados del modelo. Se cachean por referencia de cada colección, así mover un nodo
 * (cambia `views`) no reconstruye los índices de elementos ni de relaciones.
 */
export function indexOf(model: Model): ModelIndex {
  const cached = indexCache.get(model);
  if (cached) return cached;

  let el = elementIndexCache.get(model.elements);
  if (!el) {
    const childrenOf = new Map<Id | null, Id[]>();
    const membersOf = new Map<Id, Id[]>();
    for (const e of sortedValues(model.elements)) {
      push(childrenOf, e.parent ?? null, e.id);
      for (const g of e.groups ?? []) push(membersOf, g, e.id);
    }
    el = { childrenOf, membersOf };
    elementIndexCache.set(model.elements, el);
  }

  let rel = relationIndexCache.get(model.relations);
  if (!rel) {
    const relationsFrom = new Map<Id, Id[]>();
    const relationsTo = new Map<Id, Id[]>();
    for (const r of sortedValues(model.relations)) {
      push(relationsFrom, r.from, r.id);
      push(relationsTo, r.to, r.id);
    }
    rel = { relationsFrom, relationsTo };
    relationIndexCache.set(model.relations, rel);
  }

  let vw = viewIndexCache.get(model.views);
  if (!vw) {
    const viewsByScope = new Map<Id, Id[]>();
    const viewsContaining = new Map<Id, Id[]>();
    for (const v of sortedValues(model.views)) {
      if (v.scope) push(viewsByScope, v.scope, v.id);
      for (const nodeId of Object.keys(v.nodes)) push(viewsContaining, nodeId, v.id);
    }
    vw = { viewsByScope, viewsContaining };
    viewIndexCache.set(model.views, vw);
  }

  const index: ModelIndex = { ...el, ...rel, ...vw };
  indexCache.set(model, index);
  return index;
}

export function sortedValues<T extends { id: string }>(record: Readonly<Record<string, T>>): T[] {
  return Object.values(record).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Cadena de ancestros, del padre directo hacia la raíz. */
export function ancestorsOf(model: Model, id: Id): Element[] {
  const out: Element[] = [];
  const seen = new Set<Id>([id]);
  let current = model.elements[id]?.parent;
  while (current && !seen.has(current)) {
    const el = model.elements[current];
    if (!el) break;
    out.push(el);
    seen.add(current);
    current = el.parent;
  }
  return out;
}

/** True si la cadena de padres de `id` vuelve a pasar por `id`. */
export function hasParentCycle(model: Model, id: Id): boolean {
  const seen = new Set<Id>();
  let current = model.elements[id]?.parent;
  while (current) {
    if (current === id) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = model.elements[current]?.parent;
  }
  return false;
}

/** Todos los descendientes (hijos, nietos…) en orden de recorrido en profundidad. */
export function descendantsOf(model: Model, id: Id): Id[] {
  const { childrenOf } = indexOf(model);
  const out: Id[] = [];
  const stack = [...(childrenOf.get(id) ?? [])].reverse();
  const seen = new Set<Id>();
  while (stack.length) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    stack.push(...[...(childrenOf.get(next) ?? [])].reverse());
  }
  return out;
}

export function childrenOf(model: Model, id: Id | null, kinds?: readonly ElementKind[]): Element[] {
  const ids = indexOf(model).childrenOf.get(id) ?? [];
  const out: Element[] = [];
  for (const childId of ids) {
    const el = model.elements[childId];
    if (el && (!kinds || kinds.includes(el.kind))) out.push(el);
  }
  return out;
}

export function relationsOf(model: Model, id: Id): { incoming: Relation[]; outgoing: Relation[] } {
  const idx = indexOf(model);
  const pick = (ids: readonly Id[] | undefined) =>
    (ids ?? []).map((r) => model.relations[r]).filter((r): r is Relation => !!r);
  return { incoming: pick(idx.relationsTo.get(id)), outgoing: pick(idx.relationsFrom.get(id)) };
}

export function viewsContaining(model: Model, id: Id): View[] {
  return (indexOf(model).viewsContaining.get(id) ?? [])
    .map((v) => model.views[v])
    .filter((v): v is View => !!v);
}

/** Vista de detalle (L2 para un sistema, L3 para un container) si existe. */
export function childViewOf(model: Model, id: Id): View | undefined {
  const el = model.elements[id];
  if (!el) return undefined;
  const level = el.kind === 'system' ? 2 : el.kind === 'container' ? 3 : undefined;
  if (!level) return undefined;
  for (const viewId of indexOf(model).viewsByScope.get(id) ?? []) {
    const view = model.views[viewId];
    if (view?.level === level) return view;
  }
  return undefined;
}

/** Vista "padre" para navegar hacia arriba (L3 → L2 del sistema, L2 → primer L1 que lo muestra). */
export function parentViewOf(model: Model, view: View): View | undefined {
  if (view.level === 1 || !view.scope) return undefined;
  const scopeEl = model.elements[view.scope];
  if (!scopeEl) return undefined;
  if (view.level === 3 && scopeEl.parent) {
    const parentView = childViewOf(model, scopeEl.parent);
    if (parentView) return parentView;
  }
  const rank = levelRank(view.level);
  const containing = viewsContaining(model, view.scope).filter((v) => levelRank(v.level) < rank);
  containing.sort((a, b) => levelRank(b.level) - levelRank(a.level) || a.id.localeCompare(b.id));
  if (containing[0]) return containing[0];
  return Object.values(model.views).find((v) => v.level === 1);
}

/** Primer ancestro (o el propio elemento) que cumple el predicado. */
export function closestAncestorOrSelf(
  model: Model,
  id: Id,
  predicate: (el: Element) => boolean,
): Element | undefined {
  const self = model.elements[id];
  if (!self) return undefined;
  if (predicate(self)) return self;
  return ancestorsOf(model, id).find(predicate);
}

export function isExternal(el: Element): boolean {
  return el.scope === 'external';
}
