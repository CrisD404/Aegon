import type { Edge, Node } from '@xyflow/react';
import {
  childLevelOf,
  childViewOf,
  descendantsOf,
  edgeLabelSize,
  findTechnology,
  indexOf,
  isFrameKind,
  isNetworkRelation,
  NODE_TYPE_LABEL,
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

/** Elemento abierto (L2/L3) que el lienzo dibuja como marco alrededor de sus hijos. */
function boundaryScope(model: Model, view: View): Element | null {
  if (!view.scope || view.level === 'deployment') return null;
  return model.elements[view.scope] ?? null;
}

/** Rectángulo del marco del elemento abierto: los hijos ubicados, con margen y lugar para el título. */
function boundaryBox(model: Model, scope: Id, rects: ReadonlyMap<string, Rect>): Rect {
  const inside = new Set(descendantsOf(model, scope));
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
  return {
    x: x1 - pad,
    y: y1 - top,
    w: Math.max(x2 - x1 + pad * 2, 320),
    h: Math.max(y2 - y1 + top + pad, 200),
  };
}

/** Marco del elemento abierto (L2/L3) que envuelve a sus hijos ubicados. */
export function deriveBoundary(
  model: Model,
  view: View,
  nodes: readonly Node[],
): BoundaryFlowNode | null {
  const scope = boundaryScope(model, view);
  if (!scope) return null;
  const box = boundaryBox(
    model,
    scope.id,
    absoluteRects(nodes.filter((n) => n.type !== 'boundary')),
  );
  return {
    id: `${BOUNDARY_PREFIX}${scope.id}`,
    type: 'boundary',
    position: { x: box.x, y: box.y },
    width: box.w,
    height: box.h,
    // Tamaño conocido: si ReactFlow tuviera que medirlo, emitiría un cambio de dimensiones en
    // cada actualización y re-renderizaría todo el lienzo en bucle.
    measured: { width: box.w, height: box.h },
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

/** Detalle del rótulo de un grupo: región · cuenta · CIDR. */
export function groupDetail(el: ElementOf<'group'>): string {
  return [el.group.region, el.group.account, el.group.cidr].filter(Boolean).join(' · ');
}

/** Líneas bajo el nombre de un nodo de despliegue: tipo · tecnología · tamaño · región, e identificadores. */
export function deploymentCaption(el: ElementOf<'node'>): { caption: string; ids: string } {
  const technology = (el.technology ?? []).map((t) => findTechnology(t)?.name ?? t);
  return {
    caption: [NODE_TYPE_LABEL[el.node.type], ...technology, el.node.size, el.node.region]
      .filter(Boolean)
      .join(' · '),
    ids: [el.resource, ...(el.addresses ?? []), el.node.account].filter(Boolean).join(' · '),
  };
}

/** Subtítulo del marco del elemento abierto. */
export function boundaryCaption(el: Element): string {
  return el.kind === 'system' ? 'Sistema · contenedores' : 'Contenedor · componentes';
}

// Títulos de los marcos según canvas.css (`.c4-deploy__head`, `.c4-group__label`,
// `.c4-boundary__label`): ancho medio por carácter de cada tipografía, sin el costo.
const DEPLOY_NAME_CHAR_W = 7.3; // Inter 12,5 px, 650
const DEPLOY_CAPTION_CHAR_W = 6.1; // Inter 11 px
const DEPLOY_IDS_CHAR_W = 6.3; // mono 10,5 px
const DEPLOY_COUNT_CHAR_W = 6.6; // Inter 11 px, 600
const GROUP_NAME_CHAR_W = 7; // Inter 12 px, 600
const GROUP_DETAIL_CHAR_W = 6.8; // Inter 12 px, 500
const BOUNDARY_NAME_CHAR_W = 7.6; // Inter 13 px, 650
const BOUNDARY_CAPTION_CHAR_W = 6.4; // Inter 11,5 px, 500
/** Aire bajo el título. */
const TITLE_AIR = 4;

/**
 * Franja del título de un marco (nodo de despliegue, grupo o el elemento abierto en L2/L3): desde
 * la esquina superior izquierda, tan ancha como el texto y tan alta como el nombre y sus
 * subtítulos. El resto del marco es fondo, pero una etiqueta encima del título lo taparía.
 */
export function frameTitleRect(el: Element, frame: Rect): Rect {
  let w: number;
  let h: number;
  if (el.kind === 'node') {
    // Arriba 10 e izquierda 12; ícono de 26 + 8; nombre (16) y, separadas por 1, leyenda e
    // identificadores (14 cada una).
    const { caption, ids } = deploymentCaption(el);
    const count =
      el.node.instances && el.node.instances > 1
        ? 6 + `×${el.node.instances}`.length * DEPLOY_COUNT_CHAR_W
        : 0;
    const text = Math.max(
      el.name.length * DEPLOY_NAME_CHAR_W + count,
      caption.length * DEPLOY_CAPTION_CHAR_W,
      ids.length * DEPLOY_IDS_CHAR_W,
    );
    w = Math.min(12 + 26 + 8 + text, frame.w - 12);
    h = 10 + Math.max(26, 16 + 15 + (ids ? 15 : 0));
  } else if (el.kind === 'group') {
    // Arriba 10 e izquierda 12; píldora con relleno 6/8, ícono de 14 y separaciones de 6.
    const detail = groupDetail(el);
    const text =
      el.name.length * GROUP_NAME_CHAR_W + (detail ? 6 + detail.length * GROUP_DETAIL_CHAR_W : 0);
    w = Math.min(12 + 6 + 14 + 6 + text + 8, frame.w - 12);
    h = 10 + 21;
  } else {
    // Arriba 14 e izquierda 18; ícono de 15 y separaciones de 8.
    const text =
      el.name.length * BOUNDARY_NAME_CHAR_W +
      8 +
      boundaryCaption(el).length * BOUNDARY_CAPTION_CHAR_W;
    w = Math.min(18 + 15 + 8 + text, frame.w);
    h = 14 + 17;
  }
  return { x: frame.x, y: frame.y, w: Math.ceil(w), h: h + TITLE_AIR };
}

/** Puntos del trazo donde se prueba la etiqueta: primero el medio, después hacia los extremos. */
const LABEL_SPOTS = [0.5, 0.42, 0.58, 0.34, 0.66, 0.27, 0.73, 0.2, 0.8];
/** Aire alrededor de la etiqueta al comparar con nodos y con otras etiquetas. */
const LABEL_AIR = 6;
const CELL = 256;

/**
 * Ubica la etiqueta de cada flecha donde no tape un nodo, el título de un marco ni otra etiqueta:
 * la prueba en el medio del trazo y, si choca, la corre a lo largo de la curva. Las flechas cortas
 * eligen primero (tienen menos lugar); las largas se acomodan después. Si no hay ningún lugar
 * libre, queda donde tapa menos.
 */
function placeEdgeLabels(model: Model, view: View, edges: RelationFlowEdge[]): void {
  const rects = new Map<Id, Rect>();
  for (const [id, layout] of Object.entries(view.nodes)) {
    const el = model.elements[id];
    if (el) rects.set(id, { x: layout.x, y: layout.y, ...sizeOf(el, layout) });
  }
  // Índice por celdas de lo que no se puede tapar: nodos, títulos de los marcos (el resto del marco
  // es fondo) y etiquetas ya ubicadas.
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
  for (const [id, r] of rects) {
    const el = model.elements[id]!;
    add(isFrameKind(el.kind) ? frameTitleRect(el, r) : r);
  }
  const scope = boundaryScope(model, view);
  if (scope) add(frameTitleRect(scope, boundaryBox(model, scope.id, rects)));
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
