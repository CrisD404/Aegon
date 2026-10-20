import { idFromName, relationIdFor, uniqueId } from '../ids/index.ts';
import { descendantsOf, type Model } from '../model/index.ts';
import { OpError, type Op } from '../ops/index.ts';
import { KIND_LABEL, scopedParentFor, sizeOf } from '../ops/commands.ts';
import { KINDS_FOR_LEVEL, levelRank } from '../rules/hierarchy.ts';
import { SCHEMA_VERSION, type EdgeStyle, type Element, type Id, type Level, type NodeLayout, type Relation, type View } from '../schema/index.ts';

/**
 * Templates: piezas reutilizables con el mismo formato que un workspace (un `Model`).
 *
 * - **workspace**: punto de partida para un workspace nuevo (ej. el demo de banca digital).
 * - **block**: un conjunto de elementos, relaciones y layout (ej. "API Gateway + servicios")
 *   que se inserta en un lienzo con IDs nuevos. Sus elementos de primer nivel no tienen padre:
 *   al insertarlos heredan el del lienzo destino (el sistema abierto en L2, el container en L3).
 */

export type TemplateKind = 'workspace' | 'block';

export interface Template {
  id: string;
  name: string;
  description?: string;
  kind: TemplateKind;
  /** Incluido con Aegon (no se puede editar ni borrar). */
  builtin?: boolean;
  createdAt?: number;
  model: Model;
}

/** Lienzo de un bloque con su layout (posiciones relativas, empezando en 0,0). */
export const BLOCK_VIEW = 'block';

export interface TemplateStats {
  elements: number;
  relations: number;
  /** Nivel del lienzo principal (para un bloque: dónde se puede insertar). */
  level: Level | null;
}

/** Lienzo que se usa como vista previa y, en un bloque, como layout. */
export function templateMainView(template: Template): View | undefined {
  const { views, workspace } = template.model;
  if (template.kind === 'block') return views[BLOCK_VIEW];
  if (workspace.defaultView && views[workspace.defaultView]) return views[workspace.defaultView];
  return Object.values(views).sort((a, b) => levelRank(a.level) - levelRank(b.level) || a.id.localeCompare(b.id))[0];
}

export function templateStats(template: Template): TemplateStats {
  return {
    elements: Object.keys(template.model.elements).length,
    relations: Object.keys(template.model.relations).length,
    level: templateMainView(template)?.level ?? null,
  };
}

const LEVEL_NAME: Record<Level, string> = { 1: 'contexto (L1)', 2: 'contenedores (L2)', 3: 'componentes (L3)', deployment: 'despliegue' };

/** Motivo por el que un bloque no se puede insertar en un lienzo (o null si se puede). */
export function blockProblem(template: Template, view: View): string | null {
  const main = templateMainView(template);
  if (template.kind !== 'block' || !main) return 'Solo los bloques se insertan en un lienzo';
  for (const id of Object.keys(main.nodes)) {
    const el = template.model.elements[id];
    if (el && !KINDS_FOR_LEVEL[view.level].includes(el.kind)) {
      return `"${template.name}" tiene un ${KIND_LABEL[el.kind].toLowerCase()}: insertalo en un lienzo de ${LEVEL_NAME[main.level]}`;
    }
  }
  return null;
}

function depthIn(elements: Readonly<Record<Id, Element>>, id: Id): number {
  let depth = 0;
  let current = elements[id]?.parent;
  const seen = new Set<Id>();
  while (current && elements[current] && !seen.has(current)) {
    seen.add(current);
    depth++;
    current = elements[current]!.parent;
  }
  return depth;
}

/**
 * Bloque a partir de elementos de un lienzo: incluye sus descendientes (componentes de un
 * container, contenedores de un sistema), las relaciones entre todo lo incluido, el layout de la
 * selección y los lienzos de detalle de lo incluido.
 */
export function templateFromSelection(
  model: Model,
  viewId: Id,
  ids: readonly Id[],
  meta: { id: string; name: string; description?: string },
): Template {
  const view = model.views[viewId];
  if (!view) throw new OpError('not-found', `No existe el lienzo "${viewId}"`);
  const selected = ids.filter((id) => view.nodes[id] && model.elements[id]);
  if (!selected.length) throw new OpError('empty-template', 'Seleccioná al menos un elemento del lienzo');

  const included = new Set<Id>(selected);
  for (const id of selected) for (const d of descendantsOf(model, id)) included.add(d);

  const elements: Record<Id, Element> = {};
  for (const id of included) {
    const el = { ...model.elements[id]! } as Element;
    if (el.parent && !included.has(el.parent)) delete el.parent;
    if (el.groups) {
      const groups = el.groups.filter((g) => included.has(g));
      if (groups.length) el.groups = groups;
      else delete el.groups;
    }
    elements[id] = el;
  }

  const relations: Record<Id, Relation> = {};
  for (const rel of Object.values(model.relations)) {
    if (included.has(rel.from) && included.has(rel.to)) relations[rel.id] = rel;
  }

  const minX = Math.min(...selected.map((id) => view.nodes[id]!.x));
  const minY = Math.min(...selected.map((id) => view.nodes[id]!.y));
  const nodes: Record<Id, NodeLayout> = {};
  for (const id of selected) {
    const layout = view.nodes[id]!;
    nodes[id] = { ...layout, x: layout.x - minX, y: layout.y - minY };
  }
  const edges: Record<Id, EdgeStyle> = {};
  for (const [relId, style] of Object.entries(view.edges ?? {})) if (relations[relId]) edges[relId] = style;

  const views: Record<Id, View> = {
    [BLOCK_VIEW]: { id: BLOCK_VIEW, name: meta.name, level: view.level, nodes, ...(Object.keys(edges).length ? { edges } : {}) },
  };
  for (const v of Object.values(model.views)) {
    if (!v.scope || !included.has(v.scope) || v.id === viewId) continue;
    const childNodes = Object.fromEntries(Object.entries(v.nodes).filter(([n]) => included.has(n)));
    views[v.id] = { ...v, nodes: childNodes };
    delete views[v.id]!.edges;
  }

  return {
    id: meta.id,
    name: meta.name,
    ...(meta.description ? { description: meta.description } : {}),
    kind: 'block',
    model: { workspace: { schema: SCHEMA_VERSION, id: meta.id, name: meta.name }, elements, relations, views },
  };
}

/** Template de workspace con el estado actual de un modelo. */
export function templateFromWorkspace(model: Model, meta: { id: string; name: string; description?: string }): Template {
  const { passthrough: _files, ...rest } = model;
  return {
    id: meta.id,
    name: meta.name,
    ...(meta.description ? { description: meta.description } : {}),
    kind: 'workspace',
    model: rest,
  };
}

/** Modelo de un workspace nuevo creado desde un template. */
export function workspaceFromTemplate(template: Template, workspace: { id: Id; name: string }): Model {
  return { ...template.model, workspace: { ...template.model.workspace, id: workspace.id, name: workspace.name } };
}

type Box = { x: number; y: number; w: number; h: number };

/** Separación mínima entre el bloque insertado y lo que ya está en el lienzo. */
const INSERT_GAP = 32;
const SEARCH_STEP = 40;

/** Origen libre más cercano a `origin` para una caja de `w`×`h` que no pise nodos del lienzo. */
function nearestFreeOrigin(model: Model, view: View, origin: { x: number; y: number }, w: number, h: number): { x: number; y: number } {
  const boxes: Box[] = [];
  for (const [id, layout] of Object.entries(view.nodes)) {
    const el = model.elements[id];
    if (el) boxes.push({ x: layout.x, y: layout.y, ...sizeOf(el, layout) });
  }
  const free = (x: number, y: number) =>
    !boxes.some((b) => x < b.x + b.w + INSERT_GAP && b.x < x + w + INSERT_GAP && y < b.y + b.h + INSERT_GAP && b.y < y + h + INSERT_GAP);
  if (free(origin.x, origin.y)) return origin;
  // Anillos crecientes alrededor del punto pedido; en cada anillo, el candidato más cercano.
  for (let r = 1; r <= 60; r++) {
    let best: { x: number; y: number } | null = null;
    let bestDistance = Infinity;
    for (let i = -r; i <= r; i++) {
      for (const [dx, dy] of [[i, -r], [i, r], [-r, i], [r, i]] as const) {
        const distance = dx * dx + dy * dy;
        const x = origin.x + dx * SEARCH_STEP;
        const y = origin.y + dy * SEARCH_STEP;
        if (distance < bestDistance && free(x, y)) {
          best = { x, y };
          bestDistance = distance;
        }
      }
    }
    if (best) return best;
  }
  return origin;
}

/**
 * Inserta un bloque en un lienzo, centrado en `at` o en el lugar libre más cercano (no pisa
 * nodos existentes). Los elementos reciben IDs nuevos (a partir de sus nombres), los de primer
 * nivel heredan el padre del lienzo y se copian también los lienzos de detalle que traiga el bloque.
 */
export function instantiateBlockOp(model: Model, template: Template, viewId: Id, at: { x: number; y: number }): { op: Op; ids: Id[] } {
  const view = model.views[viewId];
  if (!view) throw new OpError('not-found', `No existe el lienzo "${viewId}"`);
  const problem = blockProblem(template, view);
  if (problem) throw new OpError('template-level', problem);
  const main = templateMainView(template)!;
  const src = template.model;

  const takenElements = new Set(Object.keys(model.elements));
  const idMap = new Map<Id, Id>();
  const order = Object.keys(src.elements).sort((a, b) => depthIn(src.elements, a) - depthIn(src.elements, b) || a.localeCompare(b));
  for (const id of order) {
    const el = src.elements[id]!;
    const next = idFromName(el.name, (x) => takenElements.has(x), el.kind);
    takenElements.add(next);
    idMap.set(id, next);
  }

  const ops: Op[] = [];
  for (const id of order) {
    const el = src.elements[id]!;
    const copy = { ...el, id: idMap.get(id)! } as Element;
    if (el.parent && idMap.has(el.parent)) copy.parent = idMap.get(el.parent)!;
    else {
      delete copy.parent;
      const parent = scopedParentFor(model, view, el.kind);
      if (parent) copy.parent = parent;
    }
    if (el.groups) {
      const groups = el.groups.filter((g) => idMap.has(g)).map((g) => idMap.get(g)!);
      if (groups.length) copy.groups = groups;
      else delete copy.groups;
    }
    ops.push({ type: 'element.add', element: copy });
  }

  const relMap = new Map<Id, Id>();
  const takenRelations = new Set(Object.keys(model.relations));
  for (const rel of Object.values(src.relations)) {
    const from = idMap.get(rel.from);
    const to = idMap.get(rel.to);
    if (!from || !to) continue;
    const id = relationIdFor(from, to, (x) => takenRelations.has(x));
    takenRelations.add(id);
    relMap.set(rel.id, id);
    ops.push({ type: 'relation.add', relation: { ...rel, id, from, to } });
  }

  // Layout del bloque centrado en el punto de inserción (o corrido hasta un lugar libre).
  const rects = Object.entries(main.nodes).map(([id, l]) => ({ id, ...l, ...sizeOf(src.elements[id]!, l) }));
  const width = Math.max(...rects.map((r) => r.x + r.w));
  const height = Math.max(...rects.map((r) => r.y + r.h));
  const origin = nearestFreeOrigin(model, view, { x: Math.round(at.x - width / 2), y: Math.round(at.y - height / 2) }, width, height);
  const nodes: Record<Id, NodeLayout> = {};
  for (const r of rects) {
    const layout = main.nodes[r.id]!;
    nodes[idMap.get(r.id)!] = { ...layout, x: origin.x + layout.x, y: origin.y + layout.y };
  }
  ops.push({ type: 'view.place', view: view.id, nodes });
  for (const [relId, style] of Object.entries(main.edges ?? {})) {
    const id = relMap.get(relId);
    if (id) ops.push({ type: 'view.edge', view: view.id, relation: id, style });
  }

  // Lienzos de detalle (L2/L3) de los elementos del bloque.
  const takenViews = new Set(Object.keys(model.views));
  for (const v of Object.values(src.views)) {
    if (v.id === BLOCK_VIEW || !v.scope || !idMap.has(v.scope)) continue;
    const scope = idMap.get(v.scope)!;
    const id = uniqueId(`${scope}-${v.level === 2 ? 'containers' : 'components'}`, (x) => takenViews.has(x));
    takenViews.add(id);
    const childNodes: Record<Id, NodeLayout> = {};
    for (const [n, l] of Object.entries(v.nodes)) if (idMap.has(n)) childNodes[idMap.get(n)!] = l;
    const childView: View = { id, name: v.name, level: v.level, scope, nodes: childNodes };
    const childEdges: Record<Id, EdgeStyle> = {};
    for (const [relId, style] of Object.entries(v.edges ?? {})) if (relMap.has(relId)) childEdges[relMap.get(relId)!] = style;
    if (Object.keys(childEdges).length) childView.edges = childEdges;
    ops.push({ type: 'view.add', view: childView });
  }

  return { op: { type: 'batch', ops, label: `Insertar ${template.name}` }, ids: [...idMap.values()] };
}

export * from './builtin.ts';
