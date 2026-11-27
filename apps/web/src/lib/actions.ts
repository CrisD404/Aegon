import {
  KIND_LABEL,
  STATUS_LABEL,
  AUTO_ROUTE,
  arrangeViewOp,
  edgeStyleWith,
  hasManualRoute,
  reconnectOp,
  routeResetOps,
  childViewOf,
  connectOp,
  createElementOp,
  createViewOp,
  duplicateOp,
  ensureChildViewOp,
  parentViewOf,
  placementProblem,
  sizeOf,
  viewsContaining,
  type Element,
  type ElementKind,
  type Id,
  type NodeLayout,
  type Op,
  type Status,
  type View,
  levelRank,
  canHaveParent,
  newInstance,
  fitFramesOp,
  applyOp,
  c4ChildrenOf,
  canExpandInView,
  fitExpandedOp,
  isExpandedInView,
  setDepthOp,
  toggleExpandOp,
  unplaceWithNested,
  copyDeploymentOp,
  deployAllOp,
  FRAME_PADDING,
  ancestorsOf,
  convertToInstanceOp,
  convertToNodeOp,
  createDeployedOp,
  descendantsOf,
  detailInstanceOp,
  growFramesOp,
  livesOnlyIn,
  visualParentOf,
  type DeployedSoftware,
  deploymentViewName,
  environmentsOf,
  type Depth,
  type Model,
} from '@aegon/core';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { derivedEdgeEnds } from '../canvas/derive.ts';
import { canvasApi } from '../canvas/api.ts';
import { align, distribute, type AlignMode } from './geometry.ts';
import { elkArrangeOp } from './elk-layout.ts';

/**
 * Acciones de la app: las usan el lienzo, los menús contextuales, la paleta de comandos y los
 * atajos. Todas terminan en `dispatch(op)`, así son deshacibles y aparecen en Cambios.
 */

const ws = () => useWorkspace.getState();
const ui = () => useUi.getState();

export function activeView(): View | undefined {
  const id = ui().activeViewId;
  return id ? ws().model.views[id] : undefined;
}

function dispatch(op: Op, label?: string) {
  return ws().dispatch(op, label ? { label } : {});
}

/**
 * Los marcos abiertos envuelven justo a su contenido: después de mover, crear o ubicar algo
 * adentro, se suma su ajuste al mismo lote (un solo paso de deshacer).
 */
export function withOpenFit(model: Model, viewId: Id, ops: Op[]): Op[] {
  if (!ops.length || !model.views[viewId]?.expanded?.length) return ops;
  try {
    let next = model;
    for (const op of ops) next = applyOp(next, op).model;
    const fit = fitExpandedOp(next, viewId);
    return fit ? [...ops, fit] : ops;
  } catch {
    // Si el lote es inválido, lo informa dispatch con su mensaje.
    return ops;
  }
}

/** Los marcos (nodos, grupos) crecen para seguir conteniendo lo que se crea o se ubica adentro. */
function withFrameGrow(model: Model, viewId: Id, ops: Op[], around: Id[]): Op[] {
  if (!ops.length || !around.length) return ops;
  try {
    let next = model;
    for (const op of ops) next = applyOp(next, op).model;
    const grow = growFramesOp(next, viewId, around);
    return grow ? [...ops, grow] : ops;
  } catch {
    return ops;
  }
}

/** Un nodo creado dentro de otro (un servidor en una subred) nace compacto: el de afuera crece para contenerlo. */
const NESTED_NODE_SIZE = { w: 300, h: 180 } as const;

/**
 * Punto donde cae el centro de algo nuevo en un despliegue: si cae en un nodo, se corre lo justo
 * para quedar adentro del margen de arriba y de la izquierda (el nodo crece hacia abajo y a la
 * derecha) y sin pisar lo que el nodo ya tiene.
 */
function landIn(model: Model, view: View, kind: ElementKind, at: { x: number; y: number }, size: { w: number; h: number }) {
  if (view.level !== 'deployment') return at;
  const frame = frameAt(model, view, kind, at);
  const layout = frame ? view.nodes[frame] : undefined;
  if (!frame || !layout) return at;
  const x = Math.max(at.x - size.w / 2, layout.x + FRAME_PADDING.side);
  let y = Math.max(at.y - size.h / 2, layout.y + FRAME_PADDING.top);
  // Tampoco cae encima de lo que el nodo ya tiene: baja hasta encontrar lugar.
  const siblings = Object.entries(view.nodes)
    .filter(([id]) => model.elements[id] && visualParentOf(model, view, model.elements[id]!) === frame)
    .map(([id, l]) => ({ x: l.x, y: l.y, ...sizeOf(model.elements[id]!, l) }));
  for (let i = 0; i < 40; i++) {
    const hit = siblings.find((r) => x < r.x + r.w + LAND_GAP && x + size.w + LAND_GAP > r.x && y < r.y + r.h + LAND_GAP && y + size.h + LAND_GAP > r.y);
    if (!hit) break;
    y = hit.y + hit.h + LAND_GAP;
  }
  return { x: x + size.w / 2, y: y + size.h / 2 };
}

/** Aire mínimo entre lo nuevo y lo que ya estaba en el mismo nodo. */
const LAND_GAP = 16;

/**
 * Saca de la selección lo que ya no existe (se eliminó, o se deshizo su creación): si queda un ID
 * fantasma, cada click nuevo se suma a una selección múltiple que nadie ve.
 */
export function pruneSelection() {
  const { model } = ws();
  const sel = ui().selection;
  const nodes = sel.nodes.filter((id) => model.elements[id]);
  const edges = sel.edges.filter((id) => {
    if (model.relations[id]) return true;
    const ends = derivedEdgeEnds(id);
    return !!ends && !!model.elements[ends.from] && !!model.elements[ends.to];
  });
  if (nodes.length !== sel.nodes.length || edges.length !== sel.edges.length) ui().setSelection({ nodes, edges });
}

useWorkspace.subscribe((state, prev) => {
  if (state.model !== prev.model) pruneSelection();
});

/**
 * Elemento abierto en el lugar (el más chico) que contiene el punto. Con un tipo, solo los que
 * pueden ser padre de ese tipo (un componente va en un contenedor, no en un sistema).
 */
export function openFrameAt(model: Model, view: View, point: { x: number; y: number }, kind?: ElementKind): Id | null {
  let best: { id: Id; area: number } | null = null;
  for (const id of view.expanded ?? []) {
    const el = model.elements[id];
    const layout = view.nodes[id];
    if (!el || !layout || (kind && !canHaveParent(kind, el.kind))) continue;
    const s = sizeOf(el, layout);
    if (point.x < layout.x || point.x > layout.x + s.w || point.y < layout.y || point.y > layout.y + s.h) continue;
    const area = s.w * s.h;
    if (!best || area < best.area) best = { id, area };
  }
  return best?.id ?? null;
}

export function createElementAt(
  kind: ElementKind,
  name: string,
  at: { x: number; y: number },
  opts: { connectFrom?: Id; fields?: Partial<Element> } = {},
): Id | null {
  const view = activeView();
  if (!view) return null;
  const model = ws().model;
  const nested = kind === 'node' && view.level === 'deployment' && !!frameAt(model, view, kind, at);
  const size = nested ? NESTED_NODE_SIZE : sizeOf({ kind });
  // El marco que lo contiene se decide por donde se hizo click; después el punto se acomoda adentro.
  const clicked = { x: Math.round(at.x - size.w / 2), y: Math.round(at.y - size.h / 2) };
  at = landIn(model, view, kind, at, size);
  const centered = { x: Math.round(at.x - size.w / 2), y: Math.round(at.y - size.h / 2) };
  const fields: Partial<Element> = { ...opts.fields };
  // En un lienzo de despliegue lo nuevo es de su ambiente (salvo lo que suele ser compartido:
  // un datacenter, una nube, una región).
  if (view.level === 'deployment' && view.environment && !fields.environments && (kind === 'infra' || kind === 'instance' || kind === 'node')) {
    const nodeType = kind === 'node' ? (fields as { node?: { type?: string } }).node?.type : undefined;
    if (!nodeType || !['datacenter', 'cloud', 'region', 'zone'].includes(nodeType)) fields.environments = [view.environment];
  }
  // Dentro de un elemento abierto en el lugar, lo nuevo es hijo suyo.
  const inside = fields.parent === undefined ? openFrameAt(model, view, at, kind) : null;
  if (inside) fields.parent = inside;
  const { op, id } = createElementOp(model, {
    kind,
    name: name.trim() || KIND_LABEL[kind],
    view: view.id,
    at: centered,
    fields,
  });
  const ops: Op[] = [op, ...(inside ? [] : groupMembershipOps(model, view, id, kind, clicked, size))];
  if (nested) ops.push({ type: 'view.place', view: view.id, nodes: { [id]: { ...centered, ...NESTED_NODE_SIZE } } });
  let relationId: Id | null = null;
  if (opts.connectFrom && kind !== 'group') {
    // El elemento es nuevo: la relación siempre se crea.
    const rel = connectOp(model, opts.connectFrom, id);
    if (rel.op) ops.push(rel.op);
    relationId = rel.id;
  }
  const all = withFrameGrow(model, view.id, withOpenFit(model, view.id, ops), view.level === 'deployment' ? [id] : []);
  if (!dispatch({ type: 'batch', ops: all, label: `Agregar ${name || KIND_LABEL[kind]}` })) return null;
  ui().markFresh(relationId ? [id, relationId] : [id]);
  ui().select([id], []);
  return id;
}

/**
 * Software que nace desplegado en el lienzo de despliegue actual: crea el servicio (o base, bus) en
 * el modelo y su instancia acá, dentro del nodo donde cae el punto. La instancia lleva la dirección.
 */
export function createDeployedAt(
  what: DeployedSoftware,
  name: string,
  at: { x: number; y: number },
  opts: { connectFrom?: Id; fields?: Partial<Element> } = {},
): Id | null {
  const view = activeView();
  if (!view || view.level !== 'deployment') return null;
  const model = ws().model;
  const fallback = what === 'store' ? KIND_LABEL.store : what === 'bus' ? KIND_LABEL.bus : 'Servicio';
  const parent = frameAt(model, view, 'instance', at);
  const point = landIn(model, view, 'instance', at, sizeOf({ kind: 'instance' }));
  const result = createDeployedOp(model, view.id, { what, name: name.trim() || fallback, at: point, fields: opts.fields, parent });
  if (!result || result.op.type !== 'batch') return null;
  const ops: Op[] = [...result.op.ops];
  if (opts.connectFrom) {
    const rel = connectOp(model, opts.connectFrom, result.id);
    if (rel.op) ops.push(rel.op);
  }
  if (!dispatch({ type: 'batch', ops: withFrameGrow(model, view.id, ops, [result.id]), label: result.op.label })) return null;
  ui().markFresh([result.id]);
  ui().select([result.id]);
  return result.id;
}

/** Marco del lienzo (el más chico) que contiene el punto: un nodo de despliegue o un grupo. */
export function frameAt(model: ReturnType<typeof ws>['model'], view: View, kind: ElementKind, point: { x: number; y: number }): Id | null {
  const deployment = kind === 'node' || kind === 'infra' || kind === 'instance';
  let best: { id: Id; area: number } | null = null;
  for (const [gid, layout] of Object.entries(view.nodes)) {
    const g = model.elements[gid];
    if (!g || g.kind !== (deployment ? 'node' : 'group')) continue;
    const s = sizeOf(g, layout);
    if (point.x >= layout.x && point.x <= layout.x + s.w && point.y >= layout.y && point.y <= layout.y + s.h) {
      const area = s.w * s.h;
      if (!best || area < best.area) best = { id: gid, area };
    }
  }
  return best?.id ?? null;
}

/** Si el nodo nuevo cae dentro de un marco del lienzo, queda dentro (padre o membresía). */
function groupMembershipOps(
  model: ReturnType<typeof ws>['model'],
  view: View,
  id: Id,
  kind: ElementKind,
  at: { x: number; y: number },
  size: { w: number; h: number },
): Op[] {
  const frame = frameAt(model, view, kind, { x: at.x + size.w / 2, y: at.y + size.h / 2 });
  if (!frame) return [];
  const usesParent = kind === 'group' || kind === 'node' || kind === 'infra' || kind === 'instance';
  if (usesParent && !canHaveParent(kind, model.elements[frame]!.kind)) return [];
  return [{ type: 'element.update', id, patch: usesParent ? { parent: frame } : { groups: [frame] } }];
}

/**
 * Despliega un contenedor (o base, bus, sistema) en el lienzo de despliegue actual: crea su
 * instancia para el ambiente del lienzo, dentro del nodo donde cae el punto.
 */
export function deployAt(of: Id, at: { x: number; y: number }, opts: { connectFrom?: Id } = {}): Id | null {
  const view = activeView();
  const model = ws().model;
  const target = model.elements[of];
  if (!view || view.level !== 'deployment' || !target) return null;
  const parent = frameAt(model, view, 'instance', at) ?? undefined;
  const instance = newInstance(model, of, { parent, environment: view.environment });
  const size = sizeOf(instance);
  at = landIn(model, view, 'instance', at, size);
  const pos = { x: Math.round(at.x - size.w / 2), y: Math.round(at.y - size.h / 2) };
  const ops: Op[] = [
    { type: 'element.add', element: instance },
    { type: 'view.place', view: view.id, nodes: { [instance.id]: pos } },
  ];
  if (opts.connectFrom) {
    const rel = connectOp(model, opts.connectFrom, instance.id);
    if (rel.op) ops.push(rel.op);
  }
  if (!dispatch({ type: 'batch', ops: withFrameGrow(model, view.id, ops, [instance.id]), label: `Desplegar ${target.name}` })) return null;
  ui().markFresh([instance.id]);
  ui().select([instance.id]);
  return instance.id;
}

export function placeExisting(
  id: Id,
  at: { x: number; y: number },
  opts: { connectFrom?: Id } = {},
): boolean {
  const view = activeView();
  const model = ws().model;
  const el = model.elements[id];
  if (!view || !el) return false;
  if (view.nodes[id]) {
    ui().select([id]);
    ui().toast(`"${el.name}" ya está en este lienzo`);
    return false;
  }
  // Software que cae en un despliegue se despliega: se crea su instancia, que es la que lleva
  // dirección, puertos y réplicas (un sistema puesto directo no los tiene).
  if (view.level === 'deployment' && (el.kind === 'container' || el.kind === 'store' || el.kind === 'bus' || el.kind === 'system')) {
    return !!deployAt(id, at, opts);
  }
  const problem = placementProblem(model, view, el);
  if (problem) {
    ui().toast(problem, 'error');
    return false;
  }
  const size = sizeOf(el);
  const pos = { x: Math.round(at.x - size.w / 2), y: Math.round(at.y - size.h / 2) };
  const ops: Op[] = [{ type: 'view.place', view: view.id, nodes: { [id]: pos } }];
  if (opts.connectFrom) {
    const rel = connectOp(model, opts.connectFrom, id);
    if (rel.op) ops.push(rel.op);
  }
  const all = withFrameGrow(model, view.id, withOpenFit(model, view.id, ops), view.level === 'deployment' ? [id] : []);
  if (!dispatch({ type: 'batch', ops: all, label: `Ubicar ${el.name}` })) return false;
  ui().markFresh([id]);
  ui().select([id]);
  return true;
}

/**
 * Abre o cierra un sistema o contenedor en el lugar: sus hijos aparecen dentro de un marco, en el
 * mismo lienzo. Donde no se puede (un lienzo de despliegue), abre su lienzo de detalle.
 */
export function toggleExpand(id: Id): boolean {
  const view = activeView();
  const model = ws().model;
  if (!view || !model.elements[id]) return false;
  // En un despliegue nada lleva a otro lienzo: un sistema se detalla acá, en sus contenedores.
  if (view.level === 'deployment') return detailInDeployment(id);
  if (!canExpandInView(model, view, id)) return drillInto(id);
  const opening = !isExpandedInView(view, id);
  const op = toggleExpandOp(model, view.id, id);
  if (!op || !dispatch(op)) return false;
  ui().select([id]);
  if (opening) {
    const kids = c4ChildrenOf(model, id);
    ui().markFresh(kids.map((k) => k.id));
    canvasApi.reveal([id]);
    if (!kids.length) ui().toast('Está vacío: hacé doble click adentro para crear lo que contiene');
  }
  return true;
}

/** Lleva todo el lienzo a una profundidad: contexto (1), contenedores (2) o componentes (3). */
export function setDepth(depth: Depth): boolean {
  const view = activeView();
  if (!view) return false;
  const op = setDepthOp(ws().model, view.id, depth);
  if (!op) return false;
  if (!dispatch(op)) return false;
  ui().select([]);
  // Cambió el tamaño de todo: se vuelve a encuadrar cuando ReactFlow ya tiene los nodos nuevos.
  requestAnimationFrame(() => requestAnimationFrame(() => canvasApi.fit()));
  return true;
}

export function connect(from: Id, to: Id): Id | null {
  if (from === to) return null;
  const model = ws().model;
  const result = connectOp(model, from, to);
  if (result.kind === 'exists') {
    // En C4 hay una sola relación por par: se muestra la existente en vez de duplicarla.
    ui().select([], [result.id]);
    ui().setRightTab('inspector');
    ui().toast('Ya están conectados: editá la relación existente');
    return result.id;
  }
  if (!dispatch(result.op, result.kind === 'bidirectional' ? 'Relación bidireccional' : 'Conectar'))
    return null;
  if (result.kind === 'bidirectional')
    ui().toast('Ya existía la relación inversa: ahora es bidireccional');
  else ui().markFresh([result.id]);
  ui().select([], [result.id]);
  return result.id;
}

/** Doble click en un sistema o container: abre (o crea) su vista de detalle. */
export function drillInto(id: Id): boolean {
  const model = ws().model;
  const result = ensureChildViewOp(model, id);
  if (!result) return false;
  if (
    result.op &&
    !dispatch(
      result.op,
      `Crear ${model.elements[id]?.name ?? ''} L${model.elements[id]?.kind === 'system' ? 2 : 3}`,
    )
  )
    return false;
  ui().openView(result.viewId, { transition: 'in' });
  return true;
}

export function goUp(): boolean {
  const view = activeView();
  if (!view) return false;
  const parent = parentViewOf(ws().model, view);
  if (!parent) return false;
  ui().openView(parent.id, { transition: 'out', focus: view.scope ?? null });
  return true;
}

/** Lleva al lienzo donde está el elemento (prefiriendo el actual) y lo selecciona. */
export function revealElement(id: Id) {
  const model = ws().model;
  const current = activeView();
  if (current?.nodes[id]) {
    ui().openView(current.id, { focus: id });
    return;
  }
  const view = viewsContaining(model, id).sort((a, b) => levelRank(a.level) - levelRank(b.level))[0];
  if (view) {
    ui().openView(view.id, { transition: 'fade', focus: id });
    return;
  }
  const child = childViewOf(model, id);
  if (child) {
    ui().openView(child.id, { transition: 'in' });
    return;
  }
  ui().toast(
    `"${model.elements[id]?.name ?? id}" no está en ningún lienzo: arrastralo desde el explorador.`,
  );
}

function selectedElementIds(): Id[] {
  const view = activeView();
  if (!view) return [];
  return ui().selection.nodes.filter((id) => view.nodes[id]);
}

function selectedRelationIds(): Id[] {
  const { model } = ws();
  return ui().selection.edges.filter((e) => !derivedEdgeEnds(e) && model.relations[e]);
}

/**
 * Marca la selección (elementos y relaciones) con un estado: nuevo, se modifica, se da de baja,
 * retirado, o existente para quitar la marca. Un solo paso de deshacer.
 */
export function setSelectionStatus(status: Status) {
  const { model } = ws();
  const value = status === 'live' ? null : status;
  const ops: Op[] = [];
  for (const id of selectedElementIds()) {
    const el = model.elements[id];
    if (el && (el.status ?? 'live') !== status) ops.push({ type: 'element.update', id, patch: { status: value } });
  }
  for (const id of selectedRelationIds()) {
    if ((model.relations[id]!.status ?? 'live') !== status) ops.push({ type: 'relation.update', id, patch: { status: value } });
  }
  if (!ops.length) return;
  const label = status === 'live' ? 'Quitar la marca de estado' : `Marcar como «${STATUS_LABEL[status].toLowerCase()}»`;
  dispatch(ops.length === 1 ? ops[0]! : { type: 'batch', ops, label }, label);
}

export function removeSelectionFromView() {
  const view = activeView();
  if (!view) return;
  const ids = selectedElementIds();
  const edges = selectedRelationIds();
  let ops: Op[] = [];
  if (ids.length) {
    // Un elemento abierto se va con lo que contiene.
    const out = unplaceWithNested(ws().model, view.id, ids);
    ops.push({ type: 'view.unplace', view: view.id, ids: out?.ids ?? ids });
    if (out && (view.expanded ?? []).length !== (out.expanded ?? []).length) {
      ops.push({ type: 'view.update', id: view.id, patch: { expanded: out.expanded } });
    }
  }
  for (const e of edges) ops.push({ type: 'relation.remove', id: e });
  if (!ops.length) return;
  ops = withOpenFit(ws().model, view.id, ops);
  if (
    dispatch({ type: 'batch', ops, label: ids.length ? 'Quitar del lienzo' : 'Eliminar relación' })
  ) {
    ui().select([]);
    if (ids.length) {
      ui().toast(
        `${ids.length === 1 ? 'Quitado' : `${ids.length} quitados`} de este lienzo (${ids.length === 1 ? 'sigue' : 'siguen'} en el modelo)`,
        'info',
        {
          label: 'Eliminar del modelo',
          run: () => {
            ws().undo();
            ui().select(ids);
            deleteSelectionFromModel();
          },
        },
      );
    }
  }
}

/** Operaciones para eliminar del modelo: cada elemento se lleva lo que contiene y sus relaciones. */
function removalOps(model: Model, ids: Id[], edges: Id[]): Op[] {
  const picked = new Set(ids);
  const roots = ids.filter((id) => !ancestorsOf(model, id).some((a) => picked.has(a.id)));
  const removed = new Set<Id>();
  for (const id of roots) {
    removed.add(id);
    for (const d of descendantsOf(model, id)) removed.add(d);
  }
  const loose = edges.filter((e) => {
    const rel = model.relations[e];
    return !!rel && !removed.has(rel.from) && !removed.has(rel.to);
  });
  return [...loose.map((id): Op => ({ type: 'relation.remove', id })), ...roots.map((id): Op => ({ type: 'element.remove', id }))];
}

export function deleteSelectionFromModel() {
  const model = ws().model;
  const ids = selectedElementIds();
  const edges = selectedRelationIds();
  const ops = removalOps(model, ids, edges);
  if (!ops.length) return;
  const name = ids.length === 1 ? model.elements[ids[0]!]?.name : ids.length ? `${ids.length} elementos` : undefined;
  if (dispatch({ type: 'batch', ops, label: `Eliminar ${name ?? 'relaciones'}` })) {
    ui().select([]);
    ui().toast(`Eliminado del modelo: ${name ?? 'relaciones'}`, 'info', {
      label: 'Deshacer',
      run: () => ws().undo(),
    });
  }
}

/**
 * Supr. Lo que vive solo en este lienzo se elimina del modelo (sacarlo de acá lo dejaría huérfano);
 * lo que también está en otros lienzos solo sale de este, y el aviso lo dice.
 */
export function deleteSelection() {
  const view = activeView();
  if (!view) return;
  const model = ws().model;
  const ids = selectedElementIds();
  const edges = selectedRelationIds();
  if (!ids.length) {
    if (edges.length) removeSelectionFromView();
    return;
  }
  const gone = ids.filter((id) => livesOnlyIn(model, view.id, id));
  if (!gone.length) {
    removeSelectionFromView();
    return;
  }
  const kept = ids.filter((id) => !gone.includes(id));
  let ops: Op[] = [];
  if (kept.length) {
    const out = unplaceWithNested(model, view.id, kept);
    ops.push({ type: 'view.unplace', view: view.id, ids: out?.ids ?? kept });
    if (out && (view.expanded ?? []).length !== (out.expanded ?? []).length) {
      ops.push({ type: 'view.update', id: view.id, patch: { expanded: out.expanded } });
    }
  }
  ops.push(...removalOps(model, gone, edges));
  ops = withOpenFit(model, view.id, ops);
  const name = gone.length === 1 ? (model.elements[gone[0]!]?.name ?? '') : `${gone.length} elementos`;
  if (!dispatch({ type: 'batch', ops, label: `Eliminar ${name}` })) return;
  ui().select([]);
  const message = kept.length
    ? `Eliminado: ${name}. ${kept.length === 1 ? `"${model.elements[kept[0]!]?.name}" solo salió` : `${kept.length} solo salieron`} de este lienzo porque ${kept.length === 1 ? 'está' : 'están'} en otros`
    : `Eliminado: ${name}`;
  ui().toast(message, 'info', { label: 'Deshacer', run: () => ws().undo() });
}

export function deleteElement(id: Id) {
  const name = ws().model.elements[id]?.name ?? id;
  if (dispatch({ type: 'element.remove', id }, `Eliminar ${name}`)) {
    pruneSelection();
    ui().toast(`Eliminado del modelo: ${name}`, 'info', {
      label: 'Deshacer',
      run: () => ws().undo(),
    });
  }
}

/** Sistemas puestos directo en el despliegue → instancias suyas (llevan dirección y réplicas). */
export function convertToInstances(ids: Id[]): boolean {
  const view = activeView();
  if (!view) return false;
  const model = ws().model;
  const result = convertToInstanceOp(model, view.id, ids);
  // Queda en el mismo rectángulo: los marcos que lo contienen no tienen por qué crecer ni correrse.
  if (!result || !dispatch(result.op)) return false;
  ui().markFresh(result.ids);
  ui().select(result.ids);
  ui().toast(result.ids.length === 1 ? 'Ahora es una instancia: cargale dirección y puertos en Red' : `${result.ids.length} instancias: cargales dirección y puertos en Red`, 'success');
  return true;
}

/** Sistemas que en realidad son equipos (un servidor, una VM) → nodos de despliegue, en el mismo lugar. */
export function convertToNodes(ids: Id[]): boolean {
  const view = activeView();
  if (!view) return false;
  const model = ws().model;
  const result = convertToNodeOp(model, view.id, ids);
  if (!result) return false;
  if (result.op) {
    // Ocupa el rectángulo que ocupaba el sistema: los marcos que lo contienen no crecen ni se corren.
    if (!dispatch(result.op)) return false;
    ui().markFresh(result.ids);
    ui().select(result.ids);
  }
  const skipped = result.skipped;
  if (skipped.length) {
    ui().toast(`${skipped[0]!.reason}${skipped.length > 1 ? ` (y ${skipped.length - 1} más)` : ''}`, result.ids.length ? 'info' : 'error');
  } else {
    ui().toast(result.ids.length === 1 ? 'Ahora es un nodo: cargale tipo y dirección en el inspector' : `${result.ids.length} nodos: cargales tipo y dirección en el inspector`, 'success');
  }
  return result.ids.length > 0;
}

/** Detalla un sistema del despliegue en instancias de sus contenedores, cada una con su dirección. */
export function detailInDeployment(id: Id): boolean {
  const view = activeView();
  const model = ws().model;
  const el = model.elements[id];
  if (!view || view.level !== 'deployment' || !el) return false;
  const result = detailInstanceOp(model, view.id, id);
  if (!result || result.op.type !== 'batch') {
    const system = el.kind === 'instance' ? model.elements[el.instance.of] : el;
    if (system?.kind === 'system') ui().toast(`"${system.name}" no tiene contenedores sin desplegar: creá sus servicios con doble click en el lienzo`);
    return false;
  }
  if (!dispatch({ type: 'batch', ops: withFrameGrow(model, view.id, result.op.ops, result.ids), label: result.op.label })) return false;
  ui().markFresh(result.ids);
  ui().select(result.ids);
  ui().toast(`${result.ids.length} ${result.ids.length === 1 ? 'instancia' : 'instancias'}: cada una lleva su propia dirección`, 'success', { label: 'Deshacer', run: () => ws().undo() });
  return true;
}

export function duplicateSelection() {
  const view = activeView();
  const ids = selectedElementIds();
  if (!view || !ids.length) return;
  const { op, ids: created } = duplicateOp(ws().model, view.id, ids);
  if (dispatch(op, 'Duplicar')) {
    ui().markFresh(created);
    ui().select(created);
    // La copia puede caer fuera de la vista (un marco va al costado del original): se muestra.
    canvasApi.reveal(created);
  }
}

let clipboard: Id[] = [];

export function copySelection() {
  clipboard = selectedElementIds();
  if (clipboard.length)
    ui().toast(
      `${clipboard.length === 1 ? '1 elemento copiado' : `${clipboard.length} elementos copiados`}`,
    );
}

/** Pegar en otro lienzo ubica los mismos elementos (linkeados); en el mismo lienzo, duplica. */
export function paste() {
  const view = activeView();
  if (!view || !clipboard.length) return;
  const model = ws().model;
  const existing = clipboard.filter((id) => model.elements[id]);
  const missing = existing.filter(
    (id) => !view.nodes[id] && !placementProblem(model, view, model.elements[id]!),
  );
  if (missing.length) {
    const sourceView = Object.values(model.views).find((v) => missing.every((id) => v.nodes[id]));
    const nodes: Record<Id, NodeLayout> = {};
    missing.forEach((id, i) => {
      const from = sourceView?.nodes[id];
      nodes[id] = from ? { ...from } : { x: i * 280, y: 0 };
    });
    if (dispatch({ type: 'view.place', view: view.id, nodes }, 'Pegar (linkeado)')) {
      ui().markFresh(missing);
      ui().select(missing);
      ui().toast('Pegado como referencia al mismo elemento del modelo');
    }
    return;
  }
  const inView = existing.filter((id) => view.nodes[id]);
  if (!inView.length) return;
  const { op, ids } = duplicateOp(model, view.id, inView);
  if (dispatch(op, 'Pegar')) {
    ui().markFresh(ids);
    ui().select(ids);
    canvasApi.reveal(ids);
  }
}

function rectsOf(view: View, ids: Id[]) {
  const model = ws().model;
  return ids
    .filter((id) => view.nodes[id] && model.elements[id])
    .map((id) => {
      const layout = view.nodes[id]!;
      const size = sizeOf(model.elements[id]!, layout);
      return { id, x: layout.x, y: layout.y, w: size.w, h: size.h };
    });
}

function placeAll(view: View, positions: Map<string, { x: number; y: number }>, label: string) {
  const nodes: Record<Id, NodeLayout> = {};
  for (const [id, pos] of positions) {
    const prev = view.nodes[id]!;
    if (Math.round(prev.x) === Math.round(pos.x) && Math.round(prev.y) === Math.round(pos.y))
      continue;
    nodes[id] = { ...prev, x: Math.round(pos.x), y: Math.round(pos.y) };
  }
  if (Object.keys(nodes).length) dispatch({ type: 'view.place', view: view.id, nodes }, label);
}

export function alignSelection(mode: AlignMode) {
  const view = activeView();
  if (!view) return;
  placeAll(view, align(rectsOf(view, selectedElementIds()), mode), 'Alinear');
}

export function distributeSelection(axis: 'h' | 'v') {
  const view = activeView();
  if (!view) return;
  placeAll(view, distribute(rectsOf(view, selectedElementIds()), axis), 'Distribuir');
}

let arranging = false;

/**
 * Orden automático (Shift+L): la selección, o todo el lienzo si no hay selección. ELK calcula el
 * layout en un worker; los nodos se animan hasta su lugar y recién ahí se aplica el cambio (un
 * solo paso de deshacer). Si ELK falla se usa el orden por capas del núcleo.
 */
export async function arrange() {
  const view = activeView();
  if (!view || arranging) return;
  arranging = true;
  const model = ws().model;
  const ids = selectedElementIds();
  try {
    let op: Op | null;
    try {
      op = await elkArrangeOp(model, view.id, ids);
    } catch (error) {
      console.warn('ELK falló, se usa el orden por capas', error);
      op = arrangeViewOp(model, view.id, ids);
    }
    // Si el modelo cambió mientras se calculaba (otra edición, cambio de lienzo), no se aplica.
    if (!op || op.type !== 'view.place' || ws().model !== model || ui().activeViewId !== view.id)
      return;
    await canvasApi.animateTo(op.nodes);
    // Los recorridos a mano eran para donde estaban los nodos: lo que se reordena vuelve a trazarse solo.
    const resets = routeResetOps(model, view, new Set(Object.keys(op.nodes)));
    const label = ids.length > 1 ? 'Ordenar selección' : 'Ordenar lienzo';
    dispatch(resets.length ? { type: 'batch', ops: [op, ...resets], label } : op, label);
  } finally {
    arranging = false;
  }
}

/** Lleva un extremo de una relación a otro elemento (se soltó la punta de la flecha sobre él). */
export function reconnect(relation: Id, end: 'from' | 'to', target: Id) {
  const result = reconnectOp(ws().model, relation, end, target);
  if (!result) return;
  if ('problem' in result) {
    ui().toast(result.problem);
    return;
  }
  if (dispatch(result.op)) ui().select([], [relation]);
}

/** Quita lo acomodado a mano de una relación en el lienzo activo (recorrido y puntas): la flecha vuelve a trazarse sola. */
export function resetRoute(relation: Id) {
  const view = activeView();
  if (!view || !hasManualRoute(view.edges?.[relation])) return;
  dispatch({ type: 'view.edge', view: view.id, relation, style: edgeStyleWith(view, relation, AUTO_ROUTE) }, 'Volver al trazo automático');
}

export function createView(name = 'Nuevo lienzo') {
  const model = ws().model;
  const { op, id } = createViewOp(model, name, 1);
  if (dispatch(op, `Crear lienzo ${name}`)) ui().openView(id, { transition: 'fade' });
}

export function renameView(id: Id, name: string) {
  if (!name.trim()) return;
  ws().dispatch(
    { type: 'view.update', id, patch: { name: name.trim() } },
    { coalesce: `view-name:${id}` },
  );
}

export function deleteView(id: Id) {
  const model = ws().model;
  const view = model.views[id];
  if (!view) return;
  if (!dispatch({ type: 'view.remove', id }, `Eliminar lienzo ${view.name}`)) return;
  if (ui().activeViewId === id) {
    const next = Object.values(ws().model.views).sort((a, b) => levelRank(a.level) - levelRank(b.level))[0];
    ui().openView(next?.id ?? null);
  }
  ui().toast(`Lienzo "${view.name}" eliminado (los elementos siguen en el modelo)`, 'info', {
    label: 'Deshacer',
    run: () => ws().undo(),
  });
}

export function setDefaultView(id: Id) {
  dispatch({ type: 'workspace.update', patch: { defaultView: id } }, 'Lienzo por defecto');
}

/**
 * Despliega de una vez todo lo que falta en el ambiente del lienzo: dentro de `into` (un nodo del
 * lienzo) o de un nodo nuevo con el nombre del ambiente.
 */
export function deployAll(into?: Id): boolean {
  const view = activeView();
  if (!view) return false;
  const result = deployAllOp(ws().model, view.id, into);
  if (!result) {
    ui().toast('No falta desplegar nada en este ambiente');
    return false;
  }
  if (!dispatch(result.op)) return false;
  ui().markFresh(into ? result.ids : [result.node, ...result.ids]);
  ui().select([result.node]);
  canvasApi.reveal([result.node]);
  const n = result.ids.length;
  ui().toast(into ? `${n} ${n === 1 ? 'instancia desplegada' : 'instancias desplegadas'}` : `${n} ${n === 1 ? 'instancia' : 'instancias'} en un nodo nuevo: ponele nombre y tipo`, 'success');
  return true;
}

/** Copia el despliegue del lienzo activo a otro ambiente y abre el lienzo nuevo. */
export function copyDeploymentTo(env: Id): boolean {
  const view = activeView();
  if (!view) return false;
  const model = ws().model;
  const result = copyDeploymentOp(model, view.id, env);
  if (!result || !dispatch(result.op)) return false;
  ui().openView(result.viewId, { transition: 'fade' });
  const name = environmentsOf(model).find((e) => e.id === env)?.name ?? env;
  ui().toast(`Despliegue copiado a ${name}: revisá réplicas y direcciones, que son de cada ambiente`, 'success');
  return true;
}

/** Lienzo de despliegue vacío para otro ambiente del mismo sistema. */
export function createEmptyDeployment(env: Id): boolean {
  const view = activeView();
  if (!view) return false;
  const model = ws().model;
  const { op, id } = createViewOp(model, deploymentViewName(model, env, view.scope), 'deployment', view.scope, env);
  if (!dispatch(op, 'Crear lienzo de despliegue')) return false;
  ui().openView(id, { transition: 'fade' });
  return true;
}

/** Ajusta los marcos (nodos de despliegue y grupos) del lienzo a lo que contienen. */
export function fitFrames() {
  const view = activeView();
  if (!view) return;
  const op = fitFramesOp(ws().model, view.id);
  if (!op) {
    ui().toast('Los marcos ya envuelven a su contenido');
    return;
  }
  dispatch(op, 'Ajustar marcos');
}
