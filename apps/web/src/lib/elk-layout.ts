import type { ElkExtendedEdge, ElkNode, LayoutOptions } from 'elkjs/lib/elk-api';
import {
  representativeInView,
  sizeOf,
  type Id,
  type Model,
  type NodeLayout,
  type Op,
  type View,
} from '@aegon/core';
import { visualParentOf } from '../canvas/derive.ts';

/**
 * Auto-layout con ELK (algoritmo "layered", de arriba hacia abajo). Los grupos del lienzo son
 * nodos compuestos que envuelven a sus miembros; las relaciones se toman entre los elementos que
 * representan a cada extremo en el lienzo. ELK corre en un Web Worker (`elk.worker.ts`).
 */

const ROOT_OPTIONS: LayoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.spacing.nodeNode': '56',
  'elk.layered.spacing.nodeNodeBetweenLayers': '96',
  'elk.spacing.componentComponent': '96',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.separateConnectedComponents': 'true',
  'elk.aspectRatio': '1.6',
};

/** Margen interno de un grupo: arriba deja lugar para su etiqueta. */
const GROUP_OPTIONS: LayoutOptions = {
  'elk.padding': '[top=64,left=40,bottom=40,right=40]',
};

export interface ElkPlan {
  graph: ElkNode;
  /** Elementos que se reubican (hojas y grupos). */
  targets: Id[];
  /** Esquina superior izquierda actual de lo que se ordena: el resultado se ancla ahí. */
  anchor: { x: number; y: number };
}

/**
 * Grafo de ELK para un lienzo entero o, con dos o más `ids`, solo para esa selección (plana:
 * los grupos se reajustan después alrededor de sus miembros). Null si no hay nada que ordenar.
 */
export function buildElkGraph(model: Model, view: View, ids?: readonly Id[]): ElkPlan | null {
  const selection = ids && ids.length > 1 ? new Set(ids) : null;
  const placed = Object.keys(view.nodes).filter((id) => model.elements[id]);
  const leaves = placed.filter(
    (id) => model.elements[id]!.kind !== 'group' && (!selection || selection.has(id)),
  );
  if (leaves.length < 2) return null;

  // Orden actual (arriba → abajo, izquierda → derecha): ELK lo respeta como desempate.
  const byPosition = (a: Id, b: Id) =>
    view.nodes[a]!.y - view.nodes[b]!.y || view.nodes[a]!.x - view.nodes[b]!.x;
  const elkNodes = new Map<Id, ElkNode>();
  const leafNode = (id: Id): ElkNode => {
    const el = model.elements[id]!;
    const size = sizeOf(el, view.nodes[id]);
    return {
      id,
      width: size.w,
      height: size.h,
      ...(el.kind === 'actor'
        ? { layoutOptions: { 'elk.layered.layering.layerConstraint': 'FIRST' } }
        : {}),
    };
  };
  for (const id of leaves) elkNodes.set(id, leafNode(id));

  const root: ElkNode = { id: '__root', layoutOptions: ROOT_OPTIONS, children: [], edges: [] };
  const targets = new Set<Id>(leaves);
  if (selection) {
    root.children = leaves.sort(byPosition).map((id) => elkNodes.get(id)!);
  } else {
    // Jerarquía visual: cada nodo cuelga del grupo (ubicado) que lo contiene.
    const groups = placed.filter((id) => model.elements[id]!.kind === 'group');
    const childrenOf = new Map<Id, Id[]>();
    for (const id of [...leaves, ...groups]) {
      const parent = visualParentOf(model, view, model.elements[id]!) ?? '__root';
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), id]);
    }
    const build = (id: Id): ElkNode => {
      const children = (childrenOf.get(id) ?? []).sort(byPosition);
      if (model.elements[id]?.kind !== 'group') return elkNodes.get(id)!;
      targets.add(id);
      if (!children.length) {
        const layout = view.nodes[id]!;
        return { id, width: layout.w ?? 320, height: layout.h ?? 200 };
      }
      return { id, layoutOptions: GROUP_OPTIONS, children: children.map(build) };
    };
    root.children = (childrenOf.get('__root') ?? []).sort(byPosition).map(build);
  }

  const edges: ElkExtendedEdge[] = [];
  const seen = new Set<string>();
  for (const rel of Object.values(model.relations)) {
    if (view.edges?.[rel.id]?.hidden) continue;
    const a = representativeInView(model, view, rel.from);
    const b = representativeInView(model, view, rel.to);
    if (!a || !b || a === b || !elkNodes.has(a) || !elkNodes.has(b)) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ id: `e${edges.length}`, sources: [a], targets: [b] });
  }
  root.edges = edges;

  const rects = [...targets].map((id) => ({
    ...view.nodes[id]!,
    ...sizeOf(model.elements[id]!, view.nodes[id]),
  }));
  const anchor = { x: Math.min(...rects.map((r) => r.x)), y: Math.min(...rects.map((r) => r.y)) };
  return { graph: root, targets: [...targets], anchor };
}

/** Pasa el resultado de ELK (coordenadas relativas al padre) a un `view.place` absoluto. */
export function elkResultToOp(model: Model, view: View, plan: ElkPlan, result: ElkNode): Op | null {
  const absolute = new Map<Id, { x: number; y: number; w: number; h: number }>();
  const walk = (node: ElkNode, ox: number, oy: number) => {
    for (const child of node.children ?? []) {
      const x = ox + (child.x ?? 0);
      const y = oy + (child.y ?? 0);
      absolute.set(child.id, { x, y, w: child.width ?? 0, h: child.height ?? 0 });
      walk(child, x, y);
    }
  };
  walk(result, 0, 0);
  if (!absolute.size) return null;
  const minX = Math.min(...[...absolute.values()].map((r) => r.x));
  const minY = Math.min(...[...absolute.values()].map((r) => r.y));
  const dx = plan.anchor.x - minX;
  const dy = plan.anchor.y - minY;

  const nodes: Record<Id, NodeLayout> = {};
  for (const [id, r] of absolute) {
    const prev = view.nodes[id];
    const el = model.elements[id];
    if (!prev || !el) continue;
    const x = Math.round(r.x + dx);
    const y = Math.round(r.y + dy);
    nodes[id] =
      el.kind === 'group' ? { x, y, w: Math.round(r.w), h: Math.round(r.h) } : { ...prev, x, y };
  }

  // Ordenando una selección, los grupos de sus miembros vuelven a envolverlos.
  if (plan.targets.every((id) => model.elements[id]?.kind !== 'group')) {
    for (const [gid, layout] of Object.entries(view.nodes)) {
      if (model.elements[gid]?.kind !== 'group') continue;
      const members = Object.keys(view.nodes).filter((id) =>
        model.elements[id]?.groups?.includes(gid),
      );
      if (!members.some((id) => nodes[id])) continue;
      const rs = members.map((id) => {
        const l = nodes[id] ?? view.nodes[id]!;
        return { ...l, ...sizeOf(model.elements[id]!, l) };
      });
      const x = Math.min(...rs.map((r) => r.x)) - 40;
      const y = Math.min(...rs.map((r) => r.y)) - 64;
      nodes[gid] = {
        ...layout,
        x,
        y,
        w: Math.max(...rs.map((r) => r.x + r.w)) + 40 - x,
        h: Math.max(...rs.map((r) => r.y + r.h)) + 40 - y,
      };
    }
  }
  const changed = Object.entries(nodes).filter(([id, l]) => {
    const prev = view.nodes[id]!;
    return prev.x !== l.x || prev.y !== l.y || prev.w !== l.w || prev.h !== l.h;
  });
  return changed.length
    ? { type: 'view.place', view: view.id, nodes: Object.fromEntries(changed) }
    : null;
}

// -----------------------------------------------------------------------------------------------
// Worker

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (n: ElkNode) => void; reject: (e: Error) => void }>();

/** Corre ELK en un Web Worker (o en el hilo actual donde no hay workers, como en los tests). */
export async function runElk(graph: ElkNode): Promise<ElkNode> {
  if (typeof Worker === 'undefined') {
    const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
    return new ELK().layout(graph);
  }
  if (!worker) {
    worker = new Worker(new URL('./elk.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result?: ElkNode; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.result) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error ?? 'ELK falló'));
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'ELK falló'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, graph });
  });
}

/** Op que ordena un lienzo (o una selección) con ELK. Null si no hay nada que mover. */
export async function elkArrangeOp(
  model: Model,
  viewId: Id,
  ids?: readonly Id[],
): Promise<Op | null> {
  const view = model.views[viewId];
  if (!view) return null;
  const plan = buildElkGraph(model, view, ids);
  if (!plan) return null;
  const result = await runElk(plan.graph);
  return elkResultToOp(model, view, plan, result);
}
