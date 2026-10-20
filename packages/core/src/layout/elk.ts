import { descendantsOf, type Model } from '../model/index.ts';
import type { Id, NodeLayout, View } from '../schema/index.ts';
import { allViewEdges, sizeOf, type ViewEdge } from '../ops/commands.ts';
import { relationTechnology } from '../catalog/index.ts';
import type { Op } from '../ops/index.ts';
import { isFrameKind, visualParentOf } from './index.ts';

/** Grafo de ELK (el subconjunto que usa Aegon, sin depender de `elkjs` en el núcleo). */
export type ElkLayoutOptions = Record<string, string>;

export interface ElkGraphLabel {
  text?: string;
  width: number;
  height: number;
  layoutOptions?: ElkLayoutOptions;
}

export interface ElkGraphEdge {
  id: string;
  sources: string[];
  targets: string[];
  labels?: ElkGraphLabel[];
}

export interface ElkGraphNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  layoutOptions?: ElkLayoutOptions;
  children?: ElkGraphNode[];
  edges?: ElkGraphEdge[];
}

/** Corre ELK sobre un grafo (en la app, en un Web Worker; en Node, con `elkjs`). */
export type ElkRunner = (graph: ElkGraphNode) => Promise<ElkGraphNode>;

/**
 * Auto-layout con ELK (algoritmo "layered", de arriba hacia abajo). Los grupos del lienzo son
 * nodos compuestos que envuelven a sus miembros; las relaciones se toman entre los elementos que
 * representan a cada extremo en el lienzo. Quien llama corre ELK (Web Worker en la app,
 * `elkjs` en Node para la CLI y el MCP) y pasa la función.
 */

/**
 * Separaciones: ELK las lee en cada grafo, así que van también en cada marco (grupo, nodo de
 * despliegue, límite del sistema); si no, adentro de un marco quedan las de fábrica, muy apretadas.
 * Las etiquetas de las flechas ocupan una capa propia entre las de los nodos (ver
 * `edgeLabelSize`), con `nodeNodeBetweenLayers` de cada lado: entre dos filas unidas por una
 * flecha con texto quedan 52 + alto de la etiqueta + 52, y la flecha se ve antes y después.
 */
const SPACING_OPTIONS: ElkLayoutOptions = {
  'elk.spacing.nodeNode': '56',
  'elk.layered.spacing.nodeNodeBetweenLayers': '52',
  'elk.layered.spacing.edgeNodeBetweenLayers': '30',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
  'elk.spacing.edgeLabel': '6',
  'elk.spacing.edgeNode': '24',
};

const ROOT_OPTIONS: ElkLayoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  ...SPACING_OPTIONS,
  'elk.spacing.componentComponent': '96',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.separateConnectedComponents': 'true',
  'elk.aspectRatio': '1.6',
};

/** Margen interno de un grupo: arriba deja lugar para su etiqueta. */
const GROUP_OPTIONS: ElkLayoutOptions = {
  ...SPACING_OPTIONS,
  'elk.padding': '[top=64,left=40,bottom=40,right=40]',
};

/** El límite del sistema (L2) o contenedor (L3) abierto: el mismo margen con el que se dibuja. */
const BOUNDARY_OPTIONS: ElkLayoutOptions = {
  ...SPACING_OPTIONS,
  'elk.padding': '[top=72,left=48,bottom=48,right=48]',
};
const BOUNDARY_ID = '__boundary';

/**
 * Despliegue: de izquierda a derecha (personas → infraestructura → instancias), como se leen los
 * caminos de red. El lienzo dibuja cada flecha directa entre sus nodos, con la etiqueta en el medio,
 * y no por donde la lleva ELK: con más aire entre flechas y nodos, las que saltan varias capas pasan
 * lejos de los nodos del camino y su etiqueta no cae encima de uno.
 */
const DEPLOYMENT_OPTIONS: ElkLayoutOptions = {
  'elk.direction': 'RIGHT',
  'elk.spacing.edgeNode': '60',
};

/** Texto de la etiqueta de una flecha, igual que en el lienzo: qué hace y, abajo, protocolo y puertos. */
export function edgeLabelParts(edge: Pick<ViewEdge, 'relations' | 'implied' | 'projected'>): {
  label?: string;
  tech: string;
} {
  const rel = edge.relations[0];
  if (!rel) return { tech: '' };
  const label = edge.implied
    ? edge.relations.length > 1
      ? `${edge.relations.length} relaciones`
      : (rel.label ?? 'Relación implícita')
    : edge.projected && edge.relations.length > 1
      ? `${rel.label ?? 'Relación'} +${edge.relations.length - 1}`
      : rel.label;
  return { label, tech: edge.implied ? '' : relationTechnology(rel) };
}

// Medidas de `.c4-edge-label` en el lienzo: Inter 11 px (línea 14,3), mono 10 px, hasta 200 px.
const LABEL_MAX_W = 200;
const LABEL_PAD_W = 18;
const LABEL_PAD_H = 11;
const LABEL_CHAR_W = 6.1;
const TECH_CHAR_W = 6.05;
const LABEL_LINE_H = 14.3;
const TECH_LINE_H = 13;

/** Líneas que ocupa un texto con salto por palabra y su línea más larga (en caracteres). */
function wrapText(text: string, maxChars: number): { lines: number; longest: number } {
  let lines = 1;
  let current = 0;
  let longest = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = current ? current + 1 + word.length : word.length;
    if (current && next > maxChars) {
      longest = Math.max(longest, current);
      lines += 1;
      current = word.length;
    } else {
      current = next;
    }
  }
  return { lines, longest: Math.max(longest, current) };
}

/** Tamaño aproximado de la etiqueta de una flecha tal como la dibuja el lienzo (null si no tiene). */
export function edgeLabelSize(
  edge: Pick<ViewEdge, 'relations' | 'implied' | 'projected'>,
): { width: number; height: number } | null {
  const { label, tech } = edgeLabelParts(edge);
  if (!label && !tech) return null;
  const inner = LABEL_MAX_W - LABEL_PAD_W;
  const main = label ? wrapText(label, Math.floor(inner / LABEL_CHAR_W)) : { lines: 0, longest: 0 };
  const sub = tech
    ? wrapText(`[${tech}]`, Math.floor(inner / TECH_CHAR_W))
    : { lines: 0, longest: 0 };
  const width = Math.min(
    LABEL_MAX_W,
    Math.max(main.longest * LABEL_CHAR_W, sub.longest * TECH_CHAR_W) + LABEL_PAD_W,
  );
  const height = main.lines * LABEL_LINE_H + sub.lines * TECH_LINE_H + LABEL_PAD_H;
  return { width: Math.ceil(width), height: Math.ceil(height) };
}

export interface ElkPlan {
  graph: ElkGraphNode;
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
    (id) => !isFrameKind(model.elements[id]!.kind) && (!selection || selection.has(id)),
  );
  if (leaves.length < 2) return null;

  // Orden actual (arriba → abajo, izquierda → derecha): ELK lo respeta como desempate.
  const byPosition = (a: Id, b: Id) =>
    view.nodes[a]!.y - view.nodes[b]!.y || view.nodes[a]!.x - view.nodes[b]!.x;
  const elkNodes = new Map<Id, ElkGraphNode>();
  const leafNode = (id: Id): ElkGraphNode => {
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

  // Los niveles C4, de arriba hacia abajo; el despliegue, de izquierda a derecha.
  const deployment = view.level === 'deployment';
  const options = deployment ? { ...ROOT_OPTIONS, ...DEPLOYMENT_OPTIONS } : ROOT_OPTIONS;
  const frameOptions = deployment ? { ...GROUP_OPTIONS, ...DEPLOYMENT_OPTIONS } : GROUP_OPTIONS;
  const root: ElkGraphNode = { id: '__root', layoutOptions: { ...options }, children: [], edges: [] };
  const targets = new Set<Id>(leaves);
  // Niveles que se empaquetan en vez de ordenarse enteros: la raíz y los marcos que se atraviesan.
  const packed = new Set<ElkGraphNode>();
  if (selection) {
    root.children = leaves.sort(byPosition).map((id) => elkNodes.get(id)!);
  } else {
    // Jerarquía visual: cada nodo cuelga del grupo (ubicado) que lo contiene.
    const groups = placed.filter((id) => isFrameKind(model.elements[id]!.kind));
    const childrenOf = new Map<Id, Id[]>();
    for (const id of [...leaves, ...groups]) {
      const parent = visualParentOf(model, view, model.elements[id]!) ?? '__root';
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), id]);
    }
    const build = (id: Id): ElkGraphNode => {
      const children = (childrenOf.get(id) ?? []).sort(byPosition);
      if (!isFrameKind(model.elements[id]?.kind ?? 'system')) return elkNodes.get(id)!;
      targets.add(id);
      if (!children.length) {
        const layout = view.nodes[id]!;
        return { id, width: layout.w ?? 320, height: layout.h ?? 200 };
      }
      return {
        id,
        layoutOptions: { ...frameOptions, 'elk.direction': options['elk.direction']! },
        children: children.map(build),
      };
    };
    const top = (childrenOf.get('__root') ?? []).sort(byPosition).map(build);
    // Despliegue con dos o más marcos de primer nivel (datacenter, nube…): cada uno es una franja que
    // se ordena entera y la raíz las apila, empaquetadas con lo suelto hacia 16:10, en vez de
    // encadenarlas en una sola tira larga que al encuadrar queda ilegible. Si todo va dentro de un
    // único marco (AWS, el datacenter…), se baja por los marcos únicos hasta el primer nivel con dos
    // o más: esos son las franjas y los marcos atravesados las empaquetan como la raíz.
    if (deployment) {
      const through: ElkGraphNode[] = [];
      let frames = top.filter((n) => n.children);
      while (frames.length === 1) {
        through.push(frames[0]!);
        frames = frames[0]!.children!.filter((n) => n.children);
      }
      if (frames.length > 1) {
        root.layoutOptions!['elk.hierarchyHandling'] = 'SEPARATE_CHILDREN';
        packed.add(root);
        for (const frame of through) {
          frame.layoutOptions = {
            ...options,
            ...frame.layoutOptions,
            'elk.hierarchyHandling': 'SEPARATE_CHILDREN',
          };
          packed.add(frame);
        }
        for (const frame of frames) frame.layoutOptions!['elk.hierarchyHandling'] = 'INCLUDE_CHILDREN';
      }
    }
    // L2/L3: lo del elemento abierto va dentro de su límite; lo externo queda afuera y no lo tapa.
    const inside =
      view.scope && view.level !== 'deployment' ? new Set(descendantsOf(model, view.scope)) : null;
    const within = inside ? top.filter((n) => inside.has(n.id)) : [];
    root.children =
      within.length && within.length < top.length
        ? [
            {
              id: BOUNDARY_ID,
              layoutOptions: { ...BOUNDARY_OPTIONS, 'elk.direction': options['elk.direction']! },
              children: within,
            },
            ...top.filter((n) => !inside!.has(n.id)),
          ]
        : top;
  }

  // Cada flecha va en el marco más chico que contiene a sus dos extremos (como pide ELK): si no,
  // la parte como si cruzara marcos y no le reserva lugar a su etiqueta.
  const parentOf = new Map<string, ElkGraphNode>();
  const index = (node: ElkGraphNode) => {
    for (const child of node.children ?? []) {
      parentOf.set(child.id, node);
      index(child);
    }
  };
  index(root);
  const ancestors = (id: string) => {
    const out: ElkGraphNode[] = [];
    for (let p = parentOf.get(id); p; p = parentOf.get(p.id)) out.push(p);
    return out;
  };
  const container = (a: Id, b: Id): ElkGraphNode => {
    const ofB = new Set(ancestors(b));
    return ancestors(a).find((n) => ofB.has(n)) ?? root;
  };

  let count = 0;
  const seen = new Set<string>();
  // Las del lienzo (con las implícitas y, en despliegue, las lógicas proyectadas sobre instancias).
  for (const edge of allViewEdges(model, view)) {
    const { from: a, to: b } = edge;
    if (a === b || !elkNodes.has(a) || !elkNodes.has(b)) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = edgeLabelSize(edge);
    // ELK ignora las etiquetas sin texto: el texto va aunque solo cuente el tamaño.
    const { label: text, tech } = edgeLabelParts(edge);
    const owner = container(a, b);
    // Entre franjas o de una franja hacia afuera: ELK no las usa para apilar (las traza el lienzo).
    if (packed.has(owner) && (parentOf.get(a) !== owner || parentOf.get(b) !== owner)) continue;
    owner.edges = [
      ...(owner.edges ?? []),
      {
        id: `e${count++}`,
        sources: [a],
        targets: [b],
        ...(label
          ? {
              labels: [
                {
                  ...label,
                  text: [text, tech].filter(Boolean).join(' '),
                  layoutOptions: { 'elk.edgeLabels.placement': 'CENTER' },
                },
              ],
            }
          : {}),
      },
    ];
  }

  const rects = [...targets].map((id) => ({
    ...view.nodes[id]!,
    ...sizeOf(model.elements[id]!, view.nodes[id]),
  }));
  const anchor = { x: Math.min(...rects.map((r) => r.x)), y: Math.min(...rects.map((r) => r.y)) };
  return { graph: root, targets: [...targets], anchor };
}

/** Pasa el resultado de ELK (coordenadas relativas al padre) a un `view.place` absoluto. */
export function elkResultToOp(
  model: Model,
  view: View,
  plan: ElkPlan,
  result: ElkGraphNode,
): Op | null {
  const absolute = new Map<Id, { x: number; y: number; w: number; h: number }>();
  const walk = (node: ElkGraphNode, ox: number, oy: number) => {
    for (const child of node.children ?? []) {
      const x = ox + (child.x ?? 0);
      const y = oy + (child.y ?? 0);
      absolute.set(child.id, { x, y, w: child.width ?? 0, h: child.height ?? 0 });
      walk(child, x, y);
    }
  };
  walk(result, 0, 0);
  // Solo lo que está en el lienzo (el límite del sistema es un marco auxiliar de ELK).
  const placed = [...absolute].filter(([id]) => view.nodes[id]).map(([, r]) => r);
  if (!placed.length) return null;
  const minX = Math.min(...placed.map((r) => r.x));
  const minY = Math.min(...placed.map((r) => r.y));
  const dx = plan.anchor.x - minX;
  const dy = plan.anchor.y - minY;

  const nodes: Record<Id, NodeLayout> = {};
  for (const [id, r] of absolute) {
    const prev = view.nodes[id];
    const el = model.elements[id];
    if (!prev || !el) continue;
    const x = Math.round(r.x + dx);
    const y = Math.round(r.y + dy);
    nodes[id] = isFrameKind(el.kind)
      ? { x, y, w: Math.round(r.w), h: Math.round(r.h) }
      : { ...prev, x, y };
  }

  // Ordenando una selección, los marcos de sus miembros vuelven a envolverlos.
  if (plan.targets.every((id) => !isFrameKind(model.elements[id]?.kind ?? 'system'))) {
    for (const [gid, layout] of Object.entries(view.nodes)) {
      if (!isFrameKind(model.elements[gid]?.kind ?? 'system')) continue;
      const members = Object.keys(view.nodes).filter(
        (id) => model.elements[id] && visualParentOf(model, view, model.elements[id]!) === gid,
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

/** Op que ordena un lienzo (o una selección) con ELK. Null si no hay nada que mover. */
export async function elkArrangeOp(
  model: Model,
  viewId: Id,
  run: ElkRunner,
  ids?: readonly Id[],
): Promise<Op | null> {
  const view = model.views[viewId];
  if (!view) return null;
  const plan = buildElkGraph(model, view, ids);
  if (!plan) return null;
  return elkResultToOp(model, view, plan, await run(plan.graph));
}
