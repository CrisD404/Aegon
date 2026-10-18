import {
  flowFrames,
  representativeInView,
  stepElements,
  viewForFrame,
  flowToMermaid,
  flowToText,
  newFlowId,
  type Flow,
  type FlowStep,
  type Id,
  type LeafStep,
} from '@aegon/core';
import { useUi, type StepPath, type StepPick } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { IMPLIED_PREFIX } from '../canvas/derive.ts';
import { canvasApi } from '../canvas/api.ts';

/**
 * Acciones de flujos: edición de pasos (siempre con `flow.update`, así se deshacen y aparecen en
 * Cambios) y navegación del reproductor.
 */

const ws = () => useWorkspace.getState();
const ui = () => useUi.getState();

export function flowOf(id: Id): Flow | undefined {
  return ws().model.flows?.[id];
}

// ---------------------------------------------------------------------------------------------
// Pasos por ruta

export function stepAt(flow: Flow, path: StepPath): FlowStep | LeafStep | undefined {
  const top = flow.steps[path[0]];
  if (path.length === 1 || !top) return top;
  return top.type === 'paths' ? top.paths[path[1]]?.steps[path[2]] : undefined;
}

/** Reemplaza (o quita, con `null`) el paso en `path`. */
export function replaceStep(
  steps: readonly FlowStep[],
  path: StepPath,
  step: FlowStep | null,
): FlowStep[] {
  const next = [...steps];
  if (path.length === 1) {
    if (step) next[path[0]] = step;
    else next.splice(path[0], 1);
    return next;
  }
  const [i, p, j] = path;
  const top = next[i];
  if (!top || top.type !== 'paths') return next;
  const inner = [...top.paths[p]!.steps];
  if (step) inner[j] = step as LeafStep;
  else inner.splice(j, 1);
  next[i] = { ...top, paths: top.paths.map((x, k) => (k === p ? { ...x, steps: inner } : x)) };
  return next;
}

/** Inserta un paso al final del flujo o al final de un camino. Devuelve la ruta del nuevo paso. */
export function appendStep(
  steps: readonly FlowStep[],
  step: FlowStep,
  inPath?: { top: number; path: number },
): { steps: FlowStep[]; path: StepPath } {
  if (!inPath) return { steps: [...steps, step], path: [steps.length] };
  const top = steps[inPath.top];
  if (!top || top.type !== 'paths') return { steps: [...steps, step], path: [steps.length] };
  const inner = [...top.paths[inPath.path]!.steps, step as LeafStep];
  const next = [...steps];
  next[inPath.top] = {
    ...top,
    paths: top.paths.map((x, k) => (k === inPath.path ? { ...x, steps: inner } : x)),
  };
  return { steps: next, path: [inPath.top, inPath.path, inner.length - 1] };
}

/** Mueve un paso dentro de su misma lista (flujo o camino). */
export function moveStep(steps: readonly FlowStep[], path: StepPath, to: number): FlowStep[] {
  const move = <T>(list: readonly T[], from: number): T[] => {
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, item!);
    return next;
  };
  if (path.length === 1) return move(steps, path[0]);
  const [i, p, j] = path;
  const top = steps[i];
  if (!top || top.type !== 'paths') return [...steps];
  const next = [...steps];
  next[i] = {
    ...top,
    paths: top.paths.map((x, k) => (k === p ? { ...x, steps: move(x.steps, j) } : x)),
  };
  return next;
}

export function setSteps(id: Id, steps: FlowStep[], label: string, coalesce?: string): boolean {
  return ws().dispatch(
    { type: 'flow.update', id, patch: { steps } },
    { label, ...(coalesce ? { coalesce: `${id}:${coalesce}` } : {}) },
  );
}

export function updateFlow(
  id: Id,
  patch: Partial<Pick<Flow, 'name' | 'description' | 'view'>>,
  field: string,
) {
  const clean = Object.fromEntries(
    Object.entries(patch).map(([k, v]) => [k, v === '' || v === undefined ? null : v]),
  );
  ws().dispatch(
    { type: 'flow.update', id, patch: clean },
    { coalesce: `${id}:${field}`, label: `Editar flujo ${flowOf(id)?.name ?? ''}` },
  );
}

// ---------------------------------------------------------------------------------------------
// Flujos

/** Abre un flujo en el editor y lleva el lienzo a la vista donde se reproduce. */
export function openFlow(id: Id) {
  const flow = flowOf(id);
  if (!flow) return;
  ui().setFlowEdit({ id, step: null });
  if (flow.view && ws().model.views[flow.view] && ui().activeViewId !== flow.view)
    ui().openView(flow.view, { transition: 'fade' });
}

/** Selecciona un paso y, si sus elementos no están en el lienzo actual, abre el que los muestra. */
export function selectStep(id: Id, path: StepPath | null) {
  ui().setFlowEdit({ id, step: path });
  const flow = flowOf(id);
  const step = flow && path ? stepAt(flow, path) : undefined;
  if (!flow || !step || step.type === 'paths') return;
  const model = ws().model;
  const ids = stepElements(step);
  if (!ids.length) return;
  const current = ui().activeViewId ? model.views[ui().activeViewId!] : undefined;
  const visible =
    current &&
    ids.every((e) => representativeInView(model, current, e)) &&
    (step.type !== 'message' ||
      representativeInView(model, current, step.from) !==
        representativeInView(model, current, step.to));
  if (visible) {
    canvasApi.reveal(ids.map((e) => representativeInView(model, current!, e)!).filter(Boolean));
    return;
  }
  const target = viewForFrame(model, flow, {
    key: '',
    label: '',
    top: path![0],
    kind: 'step',
    steps: [{ step, label: '' }],
  });
  if (target && target !== ui().activeViewId) ui().openView(target, { transition: 'fade' });
}

export function createFlow(name = 'Nuevo flujo'): Id | null {
  const model = ws().model;
  const id = newFlowId(model, name);
  const view = ui().activeViewId ?? undefined;
  const ok = ws().dispatch(
    { type: 'flow.add', flow: { id, name, view, steps: [] } },
    { label: `Crear flujo ${name}` },
  );
  if (!ok) return null;
  ui().setFlowEdit({ id, step: null });
  ui().setPref('sidebarTab', 'flows');
  if (!ui().sidebarOpen) ui().setPref('sidebarOpen', true);
  return id;
}

export function duplicateFlow(id: Id): Id | null {
  const flow = flowOf(id);
  if (!flow) return null;
  const name = `${flow.name} (copia)`;
  const copy = { ...structuredClone(flow), id: newFlowId(ws().model, name), name };
  if (!ws().dispatch({ type: 'flow.add', flow: copy }, { label: `Duplicar flujo ${flow.name}` }))
    return null;
  ui().setFlowEdit({ id: copy.id, step: null });
  return copy.id;
}

export function removeFlow(id: Id) {
  const flow = flowOf(id);
  if (!flow) return;
  if (ws().dispatch({ type: 'flow.remove', id }, { label: `Eliminar flujo ${flow.name}` })) {
    if (ui().flowEdit?.id === id) ui().setFlowEdit(null);
    ui().toast(`Flujo "${flow.name}" eliminado`, 'info', {
      label: 'Deshacer',
      run: () => ws().undo(),
    });
  }
}

export async function copyFlow(id: Id, format: 'text' | 'mermaid') {
  const flow = flowOf(id);
  if (!flow) return;
  const text = format === 'text' ? flowToText(ws().model, flow) : flowToMermaid(ws().model, flow);
  try {
    await navigator.clipboard.writeText(text);
    ui().toast(
      format === 'text'
        ? 'Flujo copiado como texto'
        : 'Flujo copiado como diagrama de secuencia (Mermaid)',
      'success',
    );
  } catch {
    ui().toast('No se pudo copiar al portapapeles', 'error');
  }
}

/**
 * "+ Paso" según lo que hay seleccionado en el lienzo: una relación → mensaje; dos elementos →
 * mensaje del primero al segundo; uno → proceso. Sin selección devuelve false (se elige el tipo).
 */
export function addStepFromSelection(id: Id, inPath?: { top: number; path: number }): boolean {
  const flow = flowOf(id);
  if (!flow) return false;
  const { nodes, edges } = ui().selection;
  let step: LeafStep | null = null;
  if (edges.length === 1) {
    const edge = edges[0]!;
    if (edge.startsWith(IMPLIED_PREFIX)) {
      const [from, to] = edge.slice(IMPLIED_PREFIX.length).split('>');
      if (from && to) step = { type: 'message', from, to };
    } else {
      const rel = ws().model.relations[edge];
      if (rel) step = { type: 'message', from: rel.from, to: rel.to, relation: rel.id };
    }
  } else if (nodes.length === 2) {
    step = { type: 'message', from: nodes[0]!, to: nodes[1]! };
  } else if (nodes.length === 1) {
    step = { type: 'process', element: nodes[0]! };
  }
  if (!step) return false;
  addStep(id, step, inPath);
  return true;
}

export function addStep(id: Id, step: FlowStep, inPath?: { top: number; path: number }) {
  const flow = flowOf(id);
  if (!flow) return;
  const { steps, path } = appendStep(flow.steps, step, inPath);
  if (setSteps(id, steps, 'Agregar paso')) ui().setFlowEdit({ id, step: path });
}

/** Empieza a elegir en el lienzo los elementos de un paso nuevo o existente. */
export function startPick(pick: StepPick) {
  ui().select([]);
  ui().setStepPick(pick);
}

/** Click en un nodo mientras se elige: avanza la elección o crea/actualiza el paso. */
export function pickNode(nodeId: Id): boolean {
  const pick = ui().stepPick;
  if (!pick) return false;
  const flow = flowOf(pick.flow);
  if (!flow) {
    ui().setStepPick(null);
    return true;
  }
  if (pick.kind === 'message' && !pick.from) {
    ui().setStepPick({ ...pick, from: nodeId });
    return true;
  }
  const prev = pick.path ? stepAt(flow, pick.path) : undefined;
  const base =
    prev && prev.type !== 'paths' ? { title: prev.title, description: prev.description } : {};
  const step: LeafStep =
    pick.kind === 'message'
      ? { ...base, type: 'message', from: pick.from!, to: nodeId }
      : { ...base, type: 'process', element: nodeId };
  for (const k of ['title', 'description'] as const) if (step[k] === undefined) delete step[k];
  ui().setStepPick(null);
  if (pick.path) {
    if (setSteps(flow.id, replaceStep(flow.steps, pick.path, step), 'Editar paso'))
      ui().setFlowEdit({ id: flow.id, step: pick.path });
  } else {
    addStep(
      flow.id,
      step,
      pick.append?.top !== undefined && pick.append.path !== undefined
        ? { top: pick.append.top, path: pick.append.path }
        : undefined,
    );
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Reproductor

export function playFlow(id: Id, index = -1) {
  const flow = flowOf(id);
  if (!flow) return;
  const u = ui();
  u.setSearch({ open: false });
  u.setStepPick(null);
  u.setCommentMode(false);
  u.setOpenComment(null);
  u.select([]);
  u.setPlayer({
    flow: id,
    index,
    choices: {},
    autoplay: false,
    stack: [],
    returnView: u.activeViewId,
  });
}

export function stopPlayer() {
  const player = ui().player;
  if (!player) return;
  ui().setPlayer(null);
  if (
    player.returnView &&
    ws().model.views[player.returnView] &&
    ui().activeViewId !== player.returnView
  ) {
    ui().openView(player.returnView, { transition: 'fade' });
  }
}

export function playerFrames() {
  const player = ui().player;
  const flow = player ? flowOf(player.flow) : undefined;
  return player && flow ? flowFrames(flow, player.choices) : [];
}

export function playerGo(index: number) {
  const player = ui().player;
  if (!player) return;
  const max = playerFrames().length;
  ui().setPlayer({ ...player, index: Math.max(-1, Math.min(max, index)) });
}

/** Siguiente: entra a "ir a otro flujo" y, al terminar un flujo anidado, vuelve al que lo llamó. */
export function playerNext() {
  const player = ui().player;
  if (!player) return;
  const frames = playerFrames();
  const frame = frames[player.index];
  const goto =
    frame?.steps.length === 1 && frame.steps[0]!.step.type === 'goto'
      ? frame.steps[0]!.step
      : undefined;
  if (goto && flowOf(goto.flow)) {
    ui().setPlayer({
      ...player,
      flow: goto.flow,
      index: -1,
      choices: {},
      stack: [...player.stack, { flow: player.flow, index: player.index, choices: player.choices }],
    });
    return;
  }
  if (player.index >= frames.length) {
    const parent = player.stack[player.stack.length - 1];
    if (parent)
      ui().setPlayer({
        ...player,
        ...parent,
        index: parent.index + 1,
        stack: player.stack.slice(0, -1),
      });
    else ui().setPlayer({ ...player, autoplay: false });
    return;
  }
  playerGo(player.index + 1);
}

export function playerPrev() {
  const player = ui().player;
  if (!player) return;
  if (player.index <= -1 && player.stack.length) {
    const parent = player.stack[player.stack.length - 1]!;
    ui().setPlayer({ ...player, ...parent, stack: player.stack.slice(0, -1) });
    return;
  }
  playerGo(player.index - 1);
}

/** Saltea un "ir a otro flujo" (sigue en el flujo actual). */
export function playerSkip() {
  const player = ui().player;
  if (player) playerGo(player.index + 1);
}

/** Elige un camino alternativo (en la cabecera de la bifurcación) y avanza a su primer paso. */
export function playerChoose(top: number, path: number) {
  const player = ui().player;
  if (!player) return;
  ui().setPlayer({ ...player, choices: { ...player.choices, [top]: path } });
  playerNext();
}
