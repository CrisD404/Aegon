import type { Edge, Node } from '@xyflow/react';
import {
  childLevelOf,
  childViewOf,
  descendantsOf,
  indexOf,
  representativeInView,
  sizeOf,
  type EdgeShape,
  type Element,
  type ElementOf,
  type Id,
  type Level,
  type Model,
  type Relation,
  type View,
} from '@aegon/core';

export interface ElementNodeData extends Record<string, unknown> {
  element: Element;
  level: Level;
  /** Hijos C4 (containers de un sistema, componentes de un container). */
  childCount: number;
  /** En cuántos lienzos aparece el elemento. */
  viewCount: number;
  canDrill: boolean;
  hasChildView: boolean;
  fresh: boolean;
}

export interface GroupNodeData extends Record<string, unknown> {
  element: ElementOf<'group'>;
  fresh: boolean;
}

export interface BoundaryNodeData extends Record<string, unknown> {
  element: Element;
}

export type ElementFlowNode = Node<ElementNodeData, 'element'>;
export type GroupFlowNode = Node<GroupNodeData, 'group'>;
export type BoundaryFlowNode = Node<BoundaryNodeData, 'boundary'>;
export type AegonNode = ElementFlowNode | GroupFlowNode | BoundaryFlowNode;

export interface RelationEdgeData extends Record<string, unknown> {
  relations: Relation[];
  implied: boolean;
  shape: EdgeShape;
  bidirectional: boolean;
  flow: EdgeFlow | null;
  fresh: boolean;
}

export type RelationFlowEdge = Edge<RelationEdgeData, 'relation'>;

export const BOUNDARY_PREFIX = 'boundary:';
export const IMPLIED_PREFIX = 'implied:';

function groupDepth(model: Model, id: Id): number {
  let depth = 0;
  let current = model.elements[id]?.parent;
  const seen = new Set<Id>();
  while (current && !seen.has(current)) {
    seen.add(current);
    depth++;
    current = model.elements[current]?.parent;
  }
  return depth;
}

/** Grupo (ubicado en este lienzo) que contiene visualmente al elemento: el más profundo. */
export function visualParentOf(model: Model, view: View, el: Element): Id | undefined {
  if (el.kind === 'group') {
    let current = el.parent;
    const seen = new Set<Id>();
    while (current && !seen.has(current)) {
      if (view.nodes[current]) return current;
      seen.add(current);
      current = model.elements[current]?.parent;
    }
    return undefined;
  }
  let best: Id | undefined;
  let bestDepth = -1;
  for (const g of el.groups ?? []) {
    if (!view.nodes[g] || model.elements[g]?.kind !== 'group') continue;
    const depth = groupDepth(model, g);
    if (depth > bestDepth) {
      best = g;
      bestDepth = depth;
    }
  }
  return best;
}

// Cache de `data` por elemento: si nada cambió se reutiliza el mismo objeto y el nodo memoizado
// no se vuelve a renderizar.
const dataCache = new WeakMap<Element, { key: string; data: ElementNodeData | GroupNodeData }>();

function nodeData(el: Element, extra: Omit<ElementNodeData, 'element'> | Omit<GroupNodeData, 'element'>) {
  const key = JSON.stringify(extra);
  const cached = dataCache.get(el);
  if (cached && cached.key === key) return cached.data;
  const data = { element: el, ...extra } as ElementNodeData | GroupNodeData;
  dataCache.set(el, { key, data });
  return data;
}

/** Nodos de ReactFlow para un lienzo. Las posiciones del YAML son absolutas; ReactFlow usa relativas al grupo. */
export function deriveNodes(model: Model, view: View, fresh: ReadonlySet<Id>): AegonNode[] {
  const idx = indexOf(model);
  const groups: GroupFlowNode[] = [];
  const others: ElementFlowNode[] = [];

  for (const [id, layout] of Object.entries(view.nodes)) {
    const el = model.elements[id];
    if (!el) continue;
    const size = sizeOf(el, layout);
    const parentId = visualParentOf(model, view, el);
    const parentLayout = parentId ? view.nodes[parentId] : undefined;
    const position = parentLayout ? { x: layout.x - parentLayout.x, y: layout.y - parentLayout.y } : { x: layout.x, y: layout.y };
    if (el.kind === 'group') {
      groups.push({
        id,
        type: 'group',
        position,
        width: size.w,
        height: size.h,
        ...(parentId ? { parentId } : {}),
        zIndex: -10 + groupDepth(model, id),
        data: nodeData(el, { fresh: fresh.has(id) }) as GroupNodeData,
      });
      continue;
    }
    const drillLevel = childLevelOf(el.kind);
    const childCount = drillLevel
      ? (idx.childrenOf.get(id) ?? []).filter((c) => {
          const kind = model.elements[c]?.kind;
          return drillLevel === 2 ? kind === 'container' || kind === 'store' || kind === 'bus' : kind === 'component';
        }).length
      : 0;
    others.push({
      id,
      type: 'element',
      position,
      width: size.w,
      height: size.h,
      ...(parentId ? { parentId } : {}),
      data: nodeData(el, {
        level: view.level,
        childCount,
        viewCount: (idx.viewsContaining.get(id) ?? []).length,
        canDrill: !!drillLevel,
        hasChildView: !!childViewOf(model, id),
        fresh: fresh.has(id),
      }) as ElementNodeData,
    });
  }
  // ReactFlow exige que los padres vayan antes que los hijos.
  groups.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0) || a.id.localeCompare(b.id));
  return [...groups, ...others];
}

/** Rectángulos absolutos de los nodos (resolviendo la jerarquía de grupos). */
export function absoluteRects(nodes: readonly Node[]): Map<string, { x: number; y: number; w: number; h: number }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, { x: number; y: number; w: number; h: number }>();
  const resolve = (n: Node, depth = 0): { x: number; y: number } => {
    const cached = out.get(n.id);
    if (cached) return cached;
    if (!n.parentId || depth > 20) return n.position;
    const parent = byId.get(n.parentId);
    if (!parent) return n.position;
    const p = resolve(parent, depth + 1);
    return { x: p.x + n.position.x, y: p.y + n.position.y };
  };
  for (const n of nodes) {
    const pos = resolve(n);
    out.set(n.id, {
      x: pos.x,
      y: pos.y,
      w: n.measured?.width ?? n.width ?? 0,
      h: n.measured?.height ?? n.height ?? 0,
    });
  }
  return out;
}

/** Marco del elemento abierto (L2/L3) que envuelve a sus hijos ubicados. */
export function deriveBoundary(model: Model, view: View, nodes: readonly Node[]): BoundaryFlowNode | null {
  if (!view.scope) return null;
  const scope = model.elements[view.scope];
  if (!scope) return null;
  const inside = new Set(descendantsOf(model, view.scope));
  const rects = absoluteRects(nodes.filter((n) => n.type !== 'boundary'));
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const [id, r] of rects) {
    if (!inside.has(id)) continue;
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  const pad = 40;
  const top = 56;
  if (!Number.isFinite(x1)) {
    x1 = 0;
    y1 = 0;
    x2 = 560;
    y2 = 320;
  }
  const width = Math.max(x2 - x1 + pad * 2, 320);
  const height = Math.max(y2 - y1 + top + pad, 200);
  return {
    id: `${BOUNDARY_PREFIX}${scope.id}`,
    type: 'boundary',
    position: { x: x1 - pad, y: y1 - top },
    width,
    height,
    // Tamaño conocido: si ReactFlow tuviera que medirlo, emitiría un cambio de dimensiones en
    // cada actualización y re-renderizaría todo el lienzo en bucle.
    measured: { width, height },
    selectable: false,
    draggable: false,
    focusable: false,
    connectable: false,
    zIndex: -20,
    data: { element: scope },
  };
}

/**
 * Sentido del flujo respecto de la selección: `out` = dependencia del seleccionado (se anima en
 * el sentido del trazo), `out-reverse` = dependencia en una relación bidireccional dibujada al
 * revés, `in` = alguien depende del seleccionado (solo se resalta).
 */
export type EdgeFlow = 'out' | 'out-reverse' | 'in';

function flowOf(source: Id, target: Id, bidirectional: boolean, selected: ReadonlySet<Id>): EdgeFlow | null {
  if (!selected.size) return null;
  if (selected.has(source)) return 'out';
  if (selected.has(target)) return bidirectional ? 'out-reverse' : 'in';
  return null;
}

/**
 * Relaciones del lienzo. Si un extremo no está ubicado, se usa el ancestro que sí lo está
 * (relación implícita, dibujada punteada). Hay una sola línea por par de nodos: las implícitas
 * entre el mismo par se agrupan y, si van en ambos sentidos, se dibujan bidireccionales.
 */
export function deriveEdges(
  model: Model,
  view: View,
  selectedNodes: ReadonlySet<Id>,
  selectedEdges: ReadonlySet<Id>,
  fresh: ReadonlySet<Id>,
): RelationFlowEdge[] {
  const out: RelationFlowEdge[] = [];
  const implied = new Map<string, { from: Id; to: Id; relations: Relation[]; both: boolean }>();
  const directPairs = new Set<string>();
  const pairKey = (a: Id, b: Id) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  for (const rel of Object.values(model.relations)) {
    const style = view.edges?.[rel.id];
    if (style?.hidden) continue;
    const a = representativeInView(model, view, rel.from);
    const b = representativeInView(model, view, rel.to);
    if (!a || !b || a === b) continue;
    if (a === rel.from && b === rel.to) {
      const key = pairKey(a, b);
      if (directPairs.has(key)) continue; // YAML editado a mano con relaciones repetidas
      directPairs.add(key);
      const bidirectional = rel.direction === 'bidirectional';
      out.push({
        id: rel.id,
        type: 'relation',
        source: a,
        target: b,
        selected: selectedEdges.has(rel.id),
        data: {
          relations: [rel],
          implied: false,
          shape: style?.shape ?? 'curved',
          bidirectional,
          flow: flowOf(a, b, bidirectional, selectedNodes),
          fresh: fresh.has(rel.id),
        },
      });
    } else {
      const key = pairKey(a, b);
      const entry = implied.get(key);
      if (!entry) implied.set(key, { from: a, to: b, relations: [rel], both: rel.direction === 'bidirectional' });
      else {
        entry.relations.push(rel);
        if (entry.from !== a || rel.direction === 'bidirectional') entry.both = true;
      }
    }
  }

  for (const [key, entry] of implied) {
    if (directPairs.has(key)) continue;
    const id = `${IMPLIED_PREFIX}${entry.from}>${entry.to}`;
    out.push({
      id,
      type: 'relation',
      source: entry.from,
      target: entry.to,
      selected: selectedEdges.has(id),
      deletable: false,
      data: {
        relations: entry.relations.sort((x, y) => x.id.localeCompare(y.id)),
        implied: true,
        shape: 'curved',
        bidirectional: entry.both,
        flow: flowOf(entry.from, entry.to, entry.both, selectedNodes),
        fresh: false,
      },
    });
  }
  return out;
}
