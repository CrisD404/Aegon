import { idFromName, relationIdFor, uniqueId } from '../ids/index.ts';
import {
  ancestorsOf,
  childViewOf,
  childrenOf,
  indexOf,
  type Model,
} from '../model/index.ts';
import type { Element, ElementKind, Id, Level, NodeLayout, Relation, View } from '../schema/index.ts';
import { childLevelOf } from '../rules/hierarchy.ts';
import type { Op } from './index.ts';

/**
 * Comandos de alto nivel: generan `Op`s listas para aplicar (con IDs y defaults resueltos).
 * Son la base que comparten la UI, la CLI y el servidor MCP.
 */

/** Todos los elementos comparten el mismo rectángulo compacto; el tipo se lee en el chip y la franja. */
export const DEFAULT_SIZE: Readonly<Record<ElementKind, { w: number; h: number }>> = {
  actor: { w: 220, h: 72 },
  system: { w: 220, h: 72 },
  container: { w: 220, h: 72 },
  component: { w: 220, h: 72 },
  store: { w: 220, h: 72 },
  bus: { w: 220, h: 72 },
  group: { w: 560, h: 320 },
};

export const KIND_LABEL: Readonly<Record<ElementKind, string>> = {
  actor: 'Actor',
  system: 'Sistema',
  container: 'Contenedor',
  component: 'Componente',
  store: 'Base de datos',
  bus: 'Bus de mensajería',
  group: 'Grupo',
};

export function sizeOf(el: Pick<Element, 'kind'>, layout?: NodeLayout): { w: number; h: number } {
  const def = DEFAULT_SIZE[el.kind];
  return { w: layout?.w ?? def.w, h: layout?.h ?? def.h };
}

const isElementTaken = (model: Model) => (id: Id) => !!model.elements[id];

/** Construye un elemento nuevo con ID único y los campos obligatorios de su tipo. */
export function newElement(
  model: Model,
  kind: ElementKind,
  name: string,
  fields: Partial<Element> = {},
): Element {
  const id = fields.id ?? idFromName(name, isElementTaken(model), kind);
  const base = { ...fields, id, name, kind } as Record<string, unknown>;
  if (kind === 'store' && !base.store) base.store = { engine: 'other' };
  if (kind === 'bus' && !base.bus) base.bus = { broker: 'other' };
  if (kind === 'group' && !base.group) base.group = { provider: 'other' };
  return base as unknown as Element;
}

/** Padre que hereda un elemento nuevo creado en este lienzo. */
export function scopedParentFor(model: Model, view: View, kind: ElementKind): Id | undefined {
  if (!view.scope) return undefined;
  if (view.level === 2 && (kind === 'container' || kind === 'store' || kind === 'bus')) return view.scope;
  if (view.level === 3) {
    if (kind === 'component') return view.scope;
    if (kind === 'container' || kind === 'store' || kind === 'bus') return model.elements[view.scope]?.parent;
  }
  return undefined;
}

export interface CreateElementInput {
  kind: ElementKind;
  name: string;
  fields?: Partial<Element>;
  /** Lienzo donde ubicarlo y posición (esquina superior izquierda). */
  view?: Id;
  at?: { x: number; y: number };
}

export function createElementOp(model: Model, input: CreateElementInput): { op: Op; id: Id } {
  const view = input.view ? model.views[input.view] : undefined;
  const fields: Partial<Element> = { ...input.fields };
  if (view && fields.parent === undefined) {
    const parent = scopedParentFor(model, view, input.kind);
    if (parent) fields.parent = parent;
  }
  const element = newElement(model, input.kind, input.name, fields);
  const ops: Op[] = [{ type: 'element.add', element }];
  if (view && input.at) {
    ops.push({ type: 'view.place', view: view.id, nodes: { [element.id]: { x: input.at.x, y: input.at.y } } });
  }
  return { op: ops.length === 1 ? ops[0]! : { type: 'batch', ops, label: `Agregar ${element.name}` }, id: element.id };
}

/** Relación existente entre dos elementos, en cualquier sentido (en C4 hay una por par). */
export function relationBetween(model: Model, a: Id, b: Id): Relation | undefined {
  const idx = indexOf(model);
  for (const r of idx.relationsFrom.get(a) ?? []) if (model.relations[r]?.to === b) return model.relations[r];
  for (const r of idx.relationsFrom.get(b) ?? []) if (model.relations[r]?.to === a) return model.relations[r];
  return undefined;
}

export type ConnectResult =
  | { kind: 'created'; op: Op; id: Id }
  /** Ya existía en sentido contrario: se vuelve bidireccional. */
  | { kind: 'bidirectional'; op: Op; id: Id }
  /** Ya están conectados: no se crea nada. */
  | { kind: 'exists'; op: null; id: Id };

/**
 * Conecta dos elementos respetando la regla de C4 de una relación por par: si ya existe en el
 * mismo sentido no hace nada; si existe en sentido contrario la marca como bidireccional.
 */
export function connectOp(
  model: Model,
  from: Id,
  to: Id,
  fields: Partial<Omit<Relation, 'id' | 'from' | 'to'>> = {},
): ConnectResult {
  const existing = relationBetween(model, from, to);
  if (existing) {
    if (existing.from === to && existing.direction !== 'bidirectional') {
      return { kind: 'bidirectional', op: { type: 'relation.update', id: existing.id, patch: { direction: 'bidirectional' } }, id: existing.id };
    }
    return { kind: 'exists', op: null, id: existing.id };
  }
  const id = relationIdFor(from, to, (r) => !!model.relations[r]);
  return { kind: 'created', op: { type: 'relation.add', relation: { ...fields, id, from, to } }, id };
}

/**
 * Elemento que representa a `id` dentro de un lienzo: el propio elemento o el ancestro que está
 * ubicado en él. Sirve para dibujar relaciones implícitas (IcePanel-style): si un container de
 * otro sistema llama a nuestra API, en L1 se ve como una relación entre sistemas.
 */
export function representativeInView(model: Model, view: View, id: Id): Id | undefined {
  if (view.nodes[id]) return id;
  for (const ancestor of ancestorsOf(model, id)) {
    if (ancestor.id === view.scope) return undefined;
    if (view.nodes[ancestor.id]) return ancestor.id;
  }
  return undefined;
}

export interface ViewEdge {
  /** Nodos del lienzo que une (pueden ser ancestros de los extremos reales). */
  from: Id;
  to: Id;
  /** Relaciones del modelo que representa (una si es directa, varias si es implícita). */
  relations: Relation[];
  /** True si algún extremo no está ubicado y se dibuja a través de un ancestro. */
  implied: boolean;
  bidirectional: boolean;
}

/**
 * Relaciones que se ven en un lienzo, una por par de nodos (igual que en el lienzo de la app):
 * las directas tal cual y las implícitas agrupadas por par, bidireccionales si van en ambos sentidos.
 */
export function viewEdges(model: Model, view: View): ViewEdge[] {
  const out: ViewEdge[] = [];
  const implied = new Map<string, ViewEdge>();
  const directPairs = new Set<string>();
  const pairKey = (a: Id, b: Id) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const rel of Object.values(model.relations).sort((x, y) => x.id.localeCompare(y.id))) {
    if (view.edges?.[rel.id]?.hidden) continue;
    const a = representativeInView(model, view, rel.from);
    const b = representativeInView(model, view, rel.to);
    if (!a || !b || a === b) continue;
    const key = pairKey(a, b);
    if (a === rel.from && b === rel.to) {
      if (directPairs.has(key)) continue;
      directPairs.add(key);
      out.push({ from: a, to: b, relations: [rel], implied: false, bidirectional: rel.direction === 'bidirectional' });
      continue;
    }
    const entry = implied.get(key);
    if (!entry) implied.set(key, { from: a, to: b, relations: [rel], implied: true, bidirectional: rel.direction === 'bidirectional' });
    else {
      entry.relations.push(rel);
      if (entry.from !== a || rel.direction === 'bidirectional') entry.bidirectional = true;
    }
  }
  for (const [key, entry] of implied) if (!directPairs.has(key)) out.push(entry);
  return out;
}

/** Igual que `representativeInView` pero para un lienzo de detalle que todavía no existe. */
function representativeForScope(model: Model, scope: Id, level: Level, id: Id): Id | undefined {
  const chain = [id, ...ancestorsOf(model, id).map((a) => a.id)];
  const scopeIdx = chain.indexOf(scope);
  if (scopeIdx === 0) return undefined;
  if (scopeIdx > 0) return chain[scopeIdx - 1];
  if (level === 3) {
    const system = model.elements[scope]?.parent;
    if (system) {
      const sysIdx = chain.indexOf(system);
      if (sysIdx > 0) return chain[sysIdx - 1];
    }
  }
  return chain[chain.length - 1];
}

function gridLayout(ids: Id[], model: Model, origin: { x: number; y: number }, cols?: number) {
  const nodes: Record<Id, NodeLayout> = {};
  const columns = cols ?? Math.max(1, Math.ceil(Math.sqrt(ids.length)));
  ids.forEach((id, i) => {
    const el = model.elements[id]!;
    const { w, h } = sizeOf(el);
    const col = i % columns;
    const row = Math.floor(i / columns);
    nodes[id] = { x: origin.x + col * 320 + (240 - w) / 2, y: origin.y + row * 220 + (120 - h) / 2 };
  });
  return nodes;
}

export function childViewName(el: Element): string {
  return el.kind === 'system' ? `${el.name} · Contenedores` : `${el.name} · Componentes`;
}

/**
 * Devuelve la vista de detalle (L2/L3) de un elemento. Si no existe, genera la op que la crea
 * con sus hijos y los elementos externos con los que se relacionan.
 */
export function ensureChildViewOp(model: Model, elementId: Id): { op: Op | null; viewId: Id } | null {
  const el = model.elements[elementId];
  if (!el) return null;
  const level = childLevelOf(el.kind);
  if (!level) return null;
  const existing = childViewOf(model, elementId);
  if (existing) return { op: null, viewId: existing.id };

  const childKinds: ElementKind[] = level === 2 ? ['container', 'store', 'bus'] : ['component'];
  const children = childrenOf(model, elementId, childKinds).map((c) => c.id);

  const idx = indexOf(model);
  const internal = new Set([elementId, ...children]);
  const externals: Id[] = [];
  const seen = new Set<Id>();
  const consider = (otherId: Id) => {
    const rep = representativeForScope(model, elementId, level, otherId);
    if (!rep || internal.has(rep) || seen.has(rep)) return;
    seen.add(rep);
    externals.push(rep);
  };
  const touch = [elementId, ...children];
  // Relaciones de los hijos y de sus descendientes.
  for (const child of children) {
    const stack = [child];
    while (stack.length) {
      const next = stack.pop()!;
      touch.push(next);
      stack.push(...(idx.childrenOf.get(next) ?? []));
    }
  }
  for (const t of touch) {
    for (const r of idx.relationsFrom.get(t) ?? []) consider(model.relations[r]!.to);
    for (const r of idx.relationsTo.get(t) ?? []) consider(model.relations[r]!.from);
  }

  const actors = externals.filter((id) => model.elements[id]!.kind === 'actor');
  const others = externals.filter((id) => model.elements[id]!.kind !== 'actor');
  const cols = Math.max(1, Math.ceil(Math.sqrt(children.length)));
  const rows = Math.ceil(children.length / cols);
  const nodes: Record<Id, NodeLayout> = {
    ...gridLayout(actors, model, { x: 0, y: -280 }, Math.max(actors.length, 1)),
    ...gridLayout(children, model, { x: 0, y: 0 }, cols),
    ...gridLayout(others, model, { x: 0, y: Math.max(rows, 1) * 220 + 140 }, Math.max(others.length, 1)),
  };

  const viewId = uniqueId(
    `${elementId}-${level === 2 ? 'containers' : 'components'}`,
    (v) => !!model.views[v],
  );
  const view: View = { id: viewId, name: childViewName(el), level, scope: elementId, nodes };
  return { op: { type: 'view.add', view }, viewId };
}

/** Duplica elementos (y las relaciones entre ellos) ubicándolos desplazados en el lienzo. */
export function duplicateOp(
  model: Model,
  viewId: Id,
  ids: Id[],
  offset = { x: 48, y: 48 },
): { op: Op; ids: Id[] } {
  const view = model.views[viewId];
  const taken = new Set(Object.keys(model.elements));
  const mapping = new Map<Id, Id>();
  const ops: Op[] = [];
  const nodes: Record<Id, NodeLayout> = {};
  for (const id of ids) {
    const el = model.elements[id];
    if (!el || el.kind === 'group') continue;
    const name = `${el.name} (copia)`;
    const newId = idFromName(name, (x) => taken.has(x), el.kind);
    taken.add(newId);
    mapping.set(id, newId);
    ops.push({ type: 'element.add', element: { ...el, id: newId, name } as Element });
    const layout = view?.nodes[id];
    if (layout) nodes[newId] = { ...layout, x: layout.x + offset.x, y: layout.y + offset.y };
  }
  const relTaken = new Set(Object.keys(model.relations));
  for (const rel of Object.values(model.relations)) {
    const from = mapping.get(rel.from);
    const to = mapping.get(rel.to);
    if (!from || !to) continue;
    const id = relationIdFor(from, to, (r) => relTaken.has(r));
    relTaken.add(id);
    ops.push({ type: 'relation.add', relation: { ...rel, id, from, to } });
  }
  if (view && Object.keys(nodes).length) ops.push({ type: 'view.place', view: view.id, nodes });
  return { op: { type: 'batch', ops, label: 'Duplicar' }, ids: [...mapping.values()] };
}

/** Crea un lienzo L1 vacío con nombre único. */
export function createViewOp(model: Model, name: string, level: Level = 1, scope?: Id): { op: Op; id: Id } {
  const id = idFromName(name, (v) => !!model.views[v], 'lienzo');
  const view: View = { id, name, level, nodes: {} };
  if (scope) view.scope = scope;
  return { op: { type: 'view.add', view }, id };
}
