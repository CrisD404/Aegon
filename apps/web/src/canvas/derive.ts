import type { Edge, Node } from '@xyflow/react';
import {
  childLevelOf,
  childViewOf,
  descendantsOf,
  edgeLabelSize,
  indexOf,
  isFrameKind,
  isNetworkRelation,
  projectedEdges,
  representativeInView,
  sizeOf,
  visualParentOf as coreVisualParentOf,
  type EdgeShape,
  type Element,
  type ElementOf,
  type Id,
  type Level,
  type Model,
  type Relation,
  type View,
} from '@aegon/core';
import { floatingEnds, pointOnEdge, type Rect } from './edges/geometry.ts';

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
  /** Solo instancias: el elemento que despliega (su tipo, ícono y tecnología). */
  target?: Element;
}

export interface GroupNodeData extends Record<string, unknown> {
  element: ElementOf<'group'>;
  fresh: boolean;
}

export interface DeploymentNodeData extends Record<string, unknown> {
  element: ElementOf<'node'>;
  fresh: boolean;
}

export interface BoundaryNodeData extends Record<string, unknown> {
  element: Element;
}

export type ElementFlowNode = Node<ElementNodeData, 'element'>;
export type GroupFlowNode = Node<GroupNodeData, 'group'>;
export type DeploymentFlowNode = Node<DeploymentNodeData, 'deployment'>;
export type BoundaryFlowNode = Node<BoundaryNodeData, 'boundary'>;
export type AegonNode = ElementFlowNode | GroupFlowNode | DeploymentFlowNode | BoundaryFlowNode;

/** Tipos de nodo de ReactFlow que son marcos (contienen a otros). */
export const FRAME_NODE_TYPES = new Set(['group', 'deployment']);

export interface RelationEdgeData extends Record<string, unknown> {
  relations: Relation[];
  implied: boolean;
  shape: EdgeShape;
  bidirectional: boolean;
  flow: EdgeFlow | null;
  fresh: boolean;
  /** Despliegue: relación lógica dibujada entre instancias (no hay camino de red explícito). */
  projected?: boolean;
  /** Despliegue: tramo de red (toca un nodo, infraestructura o instancia). */
  network?: boolean;
  /** Dónde va la etiqueta sobre el trazo (0 a 1) si en el medio tapa algo; sin valor, al medio. */
  labelT?: number;
}

export type RelationFlowEdge = Edge<RelationEdgeData, 'relation'>;

export const BOUNDARY_PREFIX = 'boundary:';
export const IMPLIED_PREFIX = 'implied:';
export const PROJECTED_PREFIX = 'projected:';

/** Relación que el lienzo deriva (implícita o proyectada): no es una relación del modelo. */
export function derivedEdgeEnds(id: string): { from: Id; to: Id } | null {
  const prefix = id.startsWith(IMPLIED_PREFIX)
    ? IMPLIED_PREFIX
    : id.startsWith(PROJECTED_PREFIX)
      ? PROJECTED_PREFIX
      : null;
  if (!prefix) return null;
  const [from, to] = id.slice(prefix.length).split('>');
  return from && to ? { from, to } : null;
}

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

/** Marco (grupo o nodo de despliegue ubicado en este lienzo) que contiene visualmente al elemento. */
export const visualParentOf = coreVisualParentOf;

// Cache de `data` por elemento: si nada cambió se reutiliza el mismo objeto y el nodo memoizado
// no se vuelve a renderizar.
const dataCache = new WeakMap<
  Element,
  { key: string; data: ElementNodeData | GroupNodeData | DeploymentNodeData }
>();

function nodeData(
  el: Element,
  extra:
    | Omit<ElementNodeData, 'element'>
    | Omit<GroupNodeData, 'element'>
    | Omit<DeploymentNodeData, 'element'>,
) {
  const key = JSON.stringify(extra);
  const cached = dataCache.get(el);
  if (cached && cached.key === key) return cached.data;
  const data = { element: el, ...extra } as ElementNodeData | GroupNodeData | DeploymentNodeData;
  dataCache.set(el, { key, data });
  return data;
}

/** Nodos de ReactFlow para un lienzo. Las posiciones del YAML son absolutas; ReactFlow usa relativas al grupo. */
export function deriveNodes(model: Model, view: View, fresh: ReadonlySet<Id>): AegonNode[] {
  const idx = indexOf(model);
  const groups: (GroupFlowNode | DeploymentFlowNode)[] = [];
  const others: ElementFlowNode[] = [];

  for (const [id, layout] of Object.entries(view.nodes)) {
    const el = model.elements[id];
    if (!el) continue;
    const size = sizeOf(el, layout);
    const parentId = visualParentOf(model, view, el);
    const parentLayout = parentId ? view.nodes[parentId] : undefined;
    const position = parentLayout
      ? { x: layout.x - parentLayout.x, y: layout.y - parentLayout.y }
      : { x: layout.x, y: layout.y };
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
    if (el.kind === 'node') {
      groups.push({
        id,
        type: 'deployment',
        position,
        width: size.w,
        height: size.h,
        ...(parentId ? { parentId } : {}),
        zIndex: -10 + groupDepth(model, id),
        data: nodeData(el, { fresh: fresh.has(id) }) as DeploymentNodeData,
      });
      continue;
    }
    const target = el.kind === 'instance' ? model.elements[el.instance.of] : undefined;
    const drillLevel = childLevelOf(el.kind);
    const childCount = drillLevel
      ? (idx.childrenOf.get(id) ?? []).filter((c) => {
          const kind = model.elements[c]?.kind;
          return drillLevel === 2
            ? kind === 'container' || kind === 'store' || kind === 'bus'
            : kind === 'component';
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
        ...(target ? { target } : {}),
      }) as ElementNodeData,
    });
  }
  // ReactFlow exige que los padres vayan antes que los hijos.
  groups.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0) || a.id.localeCompare(b.id));
  return [...groups, ...others];
}

/** Rectángulos absolutos de los nodos (resolviendo la jerarquía de grupos). */
export function absoluteRects(
  nodes: readonly Node[],
): Map<string, { x: number; y: number; w: number; h: number }> {
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
export function deriveBoundary(
  model: Model,
  view: View,
  nodes: readonly Node[],
): BoundaryFlowNode | null {
  if (!view.scope || view.level === 'deployment') return null;
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

function flowOf(
  source: Id,
  target: Id,
  bidirectional: boolean,
  selected: ReadonlySet<Id>,
): EdgeFlow | null {
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
          ...(view.level === 'deployment' && isNetworkRelation(model, rel)
            ? { network: true }
            : {}),
        },
      });
    } else {
      const key = pairKey(a, b);
      const entry = implied.get(key);
      if (!entry)
        implied.set(key, {
          from: a,
          to: b,
          relations: [rel],
          both: rel.direction === 'bidirectional',
        });
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

  // Despliegue: relaciones lógicas entre las instancias que no tienen un camino de red dibujado.
  if (view.level === 'deployment') {
    const explicit = out.map((e) => ({
      from: e.source,
      to: e.target,
      relations: e.data!.relations,
      implied: e.data!.implied,
      bidirectional: e.data!.bidirectional,
    }));
    for (const p of projectedEdges(model, view, explicit)) {
      const id = `${PROJECTED_PREFIX}${p.from}>${p.to}`;
      out.push({
        id,
        type: 'relation',
        source: p.from,
        target: p.to,
        selected: selectedEdges.has(id),
        deletable: false,
        data: {
          relations: p.relations,
          implied: false,
          projected: true,
          shape: view.edges?.[p.relations[0]!.id]?.shape ?? 'curved',
          bidirectional: p.bidirectional,
          flow: flowOf(p.from, p.to, p.bidirectional, selectedNodes),
          fresh: false,
        },
      });
    }
  }
  placeEdgeLabels(model, view, out);
  return out;
}

/** Puntos del trazo donde se prueba la etiqueta: primero el medio, después hacia los extremos. */
const LABEL_SPOTS = [0.5, 0.42, 0.58, 0.34, 0.66, 0.27, 0.73, 0.2, 0.8];
/** Aire alrededor de la etiqueta al comparar con nodos y con otras etiquetas. */
const LABEL_AIR = 6;
const CELL = 256;

/**
 * Ubica la etiqueta de cada flecha donde no tape un nodo ni otra etiqueta: la prueba en el medio
 * del trazo y, si choca, la corre a lo largo de la curva. Las flechas cortas eligen primero (tienen
 * menos lugar); las largas se acomodan después. Si no hay ningún lugar libre, queda donde tapa menos.
 */
function placeEdgeLabels(model: Model, view: View, edges: RelationFlowEdge[]): void {
  const rects = new Map<Id, Rect>();
  for (const [id, layout] of Object.entries(view.nodes)) {
    const el = model.elements[id];
    if (el) rects.set(id, { x: layout.x, y: layout.y, ...sizeOf(el, layout) });
  }
  // Índice por celdas de lo que no se puede tapar: nodos (los marcos son fondo) y etiquetas ya ubicadas.
  const grid = new Map<string, Rect[]>();
  const cells = (r: Rect) => {
    const keys: string[] = [];
    for (let cx = Math.floor(r.x / CELL); cx <= Math.floor((r.x + r.w) / CELL); cx++) {
      for (let cy = Math.floor(r.y / CELL); cy <= Math.floor((r.y + r.h) / CELL); cy++)
        keys.push(`${cx},${cy}`);
    }
    return keys;
  };
  const add = (r: Rect) => {
    for (const k of cells(r)) grid.set(k, [...(grid.get(k) ?? []), r]);
  };
  for (const [id, r] of rects) if (!isFrameKind(model.elements[id]!.kind)) add(r);
  const covered = (r: Rect) => {
    const seen = new Set<Rect>();
    let area = 0;
    for (const k of cells(r)) {
      for (const o of grid.get(k) ?? []) {
        if (seen.has(o)) continue;
        seen.add(o);
        const w = Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x);
        const h = Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y);
        if (w > 0 && h > 0) area += w * h;
      }
    }
    return area;
  };

  const candidates = edges
    .map((edge) => {
      const s = rects.get(edge.source);
      const t = rects.get(edge.target);
      const size = edge.data ? edgeLabelSize(edge.data) : null;
      if (!s || !t || !size || edge.data!.shape === 'step') return null;
      const ends = floatingEnds(s, t);
      return {
        edge,
        ends,
        size,
        length: Math.hypot(ends.targetX - ends.sourceX, ends.targetY - ends.sourceY),
      };
    })
    .filter((c) => c !== null)
    .sort((a, b) => a.length - b.length);

  for (const { edge, ends, size } of candidates) {
    let best: { t: number; rect: Rect; area: number } | null = null;
    for (const t of LABEL_SPOTS) {
      const p = pointOnEdge(edge.data!.shape, ends, t)!;
      const rect = {
        x: p.x - size.width / 2 - LABEL_AIR,
        y: p.y - size.height / 2 - LABEL_AIR,
        w: size.width + LABEL_AIR * 2,
        h: size.height + LABEL_AIR * 2,
      };
      const area = covered(rect);
      if (!best || area < best.area) best = { t, rect, area };
      if (area === 0) break;
    }
    if (!best) continue;
    if (best.t !== 0.5) edge.data!.labelT = best.t;
    add(best.rect);
  }
}
