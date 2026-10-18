import {
  KIND_LABEL,
  arrangeViewOp,
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
  type View,
} from '@aegon/core';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { IMPLIED_PREFIX } from '../canvas/derive.ts';
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

export function createElementAt(
  kind: ElementKind,
  name: string,
  at: { x: number; y: number },
  opts: { connectFrom?: Id; fields?: Partial<Element> } = {},
): Id | null {
  const view = activeView();
  if (!view) return null;
  const model = ws().model;
  const size = sizeOf({ kind });
  const centered = { x: Math.round(at.x - size.w / 2), y: Math.round(at.y - size.h / 2) };
  const { op, id } = createElementOp(model, {
    kind,
    name: name.trim() || KIND_LABEL[kind],
    view: view.id,
    at: centered,
    fields: opts.fields,
  });
  const ops: Op[] = [op, ...groupMembershipOps(model, view, id, kind, centered, size)];
  let relationId: Id | null = null;
  if (opts.connectFrom && kind !== 'group') {
    // El elemento es nuevo: la relación siempre se crea.
    const rel = connectOp(model, opts.connectFrom, id);
    if (rel.op) ops.push(rel.op);
    relationId = rel.id;
  }
  if (!dispatch({ type: 'batch', ops, label: `Agregar ${name || KIND_LABEL[kind]}` })) return null;
  ui().markFresh(relationId ? [id, relationId] : [id]);
  ui().select([id], []);
  return id;
}

/** Si el nodo nuevo cae dentro de un grupo del lienzo, lo suma como miembro. */
function groupMembershipOps(
  model: ReturnType<typeof ws>['model'],
  view: View,
  id: Id,
  kind: ElementKind,
  at: { x: number; y: number },
  size: { w: number; h: number },
): Op[] {
  const cx = at.x + size.w / 2;
  const cy = at.y + size.h / 2;
  let best: { id: Id; area: number } | null = null;
  for (const [gid, layout] of Object.entries(view.nodes)) {
    const g = model.elements[gid];
    if (g?.kind !== 'group') continue;
    const s = sizeOf(g, layout);
    if (cx >= layout.x && cx <= layout.x + s.w && cy >= layout.y && cy <= layout.y + s.h) {
      const area = s.w * s.h;
      if (!best || area < best.area) best = { id: gid, area };
    }
  }
  if (!best) return [];
  return [
    {
      type: 'element.update',
      id,
      patch: kind === 'group' ? { parent: best.id } : { groups: [best.id] },
    },
  ];
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
  if (!dispatch({ type: 'batch', ops, label: `Ubicar ${el.name}` })) return false;
  ui().markFresh([id]);
  ui().select([id]);
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
  const view = viewsContaining(model, id).sort((a, b) => a.level - b.level)[0];
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

export function removeSelectionFromView() {
  const view = activeView();
  if (!view) return;
  const ids = selectedElementIds();
  const edges = ui().selection.edges.filter(
    (e) => !e.startsWith(IMPLIED_PREFIX) && ws().model.relations[e],
  );
  const ops: Op[] = [];
  if (ids.length) ops.push({ type: 'view.unplace', view: view.id, ids });
  for (const e of edges) ops.push({ type: 'relation.remove', id: e });
  if (!ops.length) return;
  if (
    dispatch({ type: 'batch', ops, label: ids.length ? 'Quitar del lienzo' : 'Eliminar relación' })
  ) {
    ui().select([]);
    if (ids.length) {
      ui().toast(
        `${ids.length === 1 ? 'Quitado' : `${ids.length} quitados`} del lienzo (siguen en el modelo)`,
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

export function deleteSelectionFromModel() {
  const ids = selectedElementIds();
  const edges = ui().selection.edges.filter(
    (e) => !e.startsWith(IMPLIED_PREFIX) && ws().model.relations[e],
  );
  const ops: Op[] = [
    ...ids.map((id): Op => ({ type: 'element.remove', id })),
    ...edges.map((id): Op => ({ type: 'relation.remove', id })),
  ];
  if (!ops.length) return;
  const name = ids.length === 1 ? ws().model.elements[ids[0]!]?.name : `${ids.length} elementos`;
  if (dispatch({ type: 'batch', ops, label: `Eliminar ${name ?? 'relaciones'}` })) {
    ui().select([]);
    ui().toast(`Eliminado del modelo: ${name ?? 'relaciones'}`, 'info', {
      label: 'Deshacer',
      run: () => ws().undo(),
    });
  }
}

export function deleteElement(id: Id) {
  const name = ws().model.elements[id]?.name ?? id;
  if (dispatch({ type: 'element.remove', id }, `Eliminar ${name}`)) {
    ui().toast(`Eliminado del modelo: ${name}`, 'info', {
      label: 'Deshacer',
      run: () => ws().undo(),
    });
  }
}

export function duplicateSelection() {
  const view = activeView();
  const ids = selectedElementIds();
  if (!view || !ids.length) return;
  const { op, ids: created } = duplicateOp(ws().model, view.id, ids);
  if (dispatch(op, 'Duplicar')) {
    ui().markFresh(created);
    ui().select(created);
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
    dispatch(op, ids.length > 1 ? 'Ordenar selección' : 'Ordenar lienzo');
  } finally {
    arranging = false;
  }
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
    const next = Object.values(ws().model.views).sort((a, b) => a.level - b.level)[0];
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
