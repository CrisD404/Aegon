import {
  pathLetter,
  relationForStep,
  sizeOf,
  sortedValues,
  stepElements,
  stepLabel,
  stepTitle,
  newFlowId,
  validateModel,
  viewsContaining,
  type Comment,
  type CommentColor,
  type CommentIcon,
  type CommentPatch,
  type Diagnostic,
  type Element,
  type Flow,
  type FlowPatch,
  type FlowStep,
  type Id,
  type LeafStep,
  type Model,
  type Op,
  type View,
} from '@aegon/core';
import { WorkspaceError, resolveRef } from './workspace.ts';

/**
 * Flujos y comentarios para la CLI y el servidor MCP: resúmenes, pasos numerados como en la app y
 * la `Op` de cada edición. Las referencias a elementos, lienzos y flujos aceptan ID o nombre.
 */

const element = (model: Model, ref: string): Element => resolveRef(sortedValues(model.elements), ref, 'elemento');
const view = (model: Model, ref: string): View => resolveRef(sortedValues(model.views), ref, 'lienzo');

/** Diagnósticos de validación de una entidad (flujo o comentario). */
function diagnosticsOf(model: Model, type: 'flow' | 'comment', id: Id): Diagnostic[] {
  return validateModel(model).filter((d) => d.entity?.type === type && d.entity.id === id);
}

// ---------------------------------------------------------------------------------------------
// Flujos: lectura

export function findFlow(model: Model, ref: string): Flow {
  return resolveRef(sortedValues(model.flows ?? {}), ref, 'flujo');
}

/** Resumen de un flujo para listados. */
export function flowBrief(flow: Flow) {
  return {
    id: flow.id,
    name: flow.name,
    ...(flow.description ? { description: flow.description } : {}),
    view: flow.view ?? null,
    steps: flow.steps.length,
    elements: [...new Set(flow.steps.flatMap(stepElements))],
  };
}

export interface NumberedStep {
  /** Número visible: `3`, o `3A.2` dentro del camino A del paso 3. */
  n: string;
  type: FlowStep['type'];
  /** El título del paso o, si no tiene, el que muestra la app (la etiqueta de la relación…). */
  title: string;
  description?: string;
  from?: Id;
  to?: Id;
  /** Relación que dibuja el mensaje (la indicada o la del par); null si no hay ninguna. */
  relation?: Id | null;
  element?: Id;
  flow?: Id;
  mode?: 'alternate' | 'parallel';
  paths?: { letter: string; name: string; steps: NumberedStep[] }[];
}

function numberLeaf(model: Model, step: LeafStep, n: string): NumberedStep {
  const out: NumberedStep = { n, type: step.type, title: stepTitle(model, step) };
  if (step.description) out.description = step.description;
  if (step.type === 'message') Object.assign(out, { from: step.from, to: step.to, relation: relationForStep(model, step)?.id ?? null });
  else if (step.type === 'process') out.element = step.element;
  else if (step.type === 'goto') out.flow = step.flow;
  return out;
}

/** Pasos con su número y su título visible, como los muestra la app. */
export function numberedSteps(model: Model, flow: Flow): NumberedStep[] {
  return flow.steps.map((step, i): NumberedStep => {
    if (step.type !== 'paths') return numberLeaf(model, step, stepLabel(i));
    return {
      n: stepLabel(i),
      type: 'paths',
      title: stepTitle(model, step),
      ...(step.description ? { description: step.description } : {}),
      mode: step.mode,
      paths: step.paths.map((p, pi) => ({
        letter: pathLetter(pi),
        name: p.name,
        steps: p.steps.map((s, j) => numberLeaf(model, s, stepLabel(i, pi, j))),
      })),
    };
  });
}

/** Un paso numerado por su número visible (`3`, `5A.2`). */
export function numberedStepAt(model: Model, flow: Flow, n: string): NumberedStep | undefined {
  for (const s of numberedSteps(model, flow)) {
    if (s.n === n) return s;
    for (const p of s.paths ?? []) {
      const hit = p.steps.find((x) => x.n === n);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Flujo completo: tal como está en el YAML, con los pasos numerados y sus avisos. */
export function flowDetail(model: Model, flow: Flow) {
  return { flow, steps: numberedSteps(model, flow), diagnostics: diagnosticsOf(model, 'flow', flow.id) };
}

// ---------------------------------------------------------------------------------------------
// Flujos: edición

/** Un paso como lo escribe un agente o un script: referencias por ID o nombre. */
export interface StepInput {
  type: FlowStep['type'];
  title?: string;
  description?: string;
  /** message */
  from?: string;
  to?: string;
  relation?: string;
  /** process */
  element?: string;
  /** goto */
  flow?: string;
  /** paths */
  mode?: 'alternate' | 'parallel';
  paths?: (string | { name: string; steps?: StepInput[] })[];
}

const STEP_TYPES = ['message', 'process', 'note', 'goto', 'paths'] as const;

function required(value: string | undefined, field: string, type: string): string {
  if (!value?.trim()) throw new WorkspaceError('invalid-step', `Un paso ${type} necesita \`${field}\``);
  return value;
}

/**
 * Arma un paso validando sus referencias. Un mensaje sin relación entre sus extremos es válido
 * (la app dibuja una flecha temporal) pero se avisa.
 */
export function buildStep(model: Model, input: StepInput, warnings: string[], inPath = false): FlowStep {
  const base = {
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
  };
  switch (input.type) {
    case 'message': {
      const from = element(model, required(input.from, 'from', 'message'));
      const to = element(model, required(input.to, 'to', 'message'));
      let relation: Id | undefined;
      if (input.relation) {
        const rel = model.relations[input.relation];
        if (!rel) throw new WorkspaceError('not-found', `No existe la relación "${input.relation}"`);
        relation = rel.id;
      }
      const step: LeafStep = { ...base, type: 'message', from: from.id, to: to.id, ...(relation ? { relation } : {}) };
      if (!relationForStep(model, step)) {
        warnings.push(`No hay relación entre "${from.name}" y "${to.name}": la app dibuja una flecha temporal. Si se comunican de verdad, conectalos.`);
      }
      return step;
    }
    case 'process':
      return { ...base, type: 'process', element: element(model, required(input.element, 'element', 'process')).id };
    case 'note':
      return { ...base, type: 'note' };
    case 'goto':
      return { ...base, type: 'goto', flow: findFlow(model, required(input.flow, 'flow', 'goto')).id };
    case 'paths': {
      if (inPath) throw new WorkspaceError('invalid-step', 'Un camino no puede contener otra bifurcación (los caminos tienen un solo nivel)');
      if (!input.paths?.length) throw new WorkspaceError('invalid-step', 'Un paso paths necesita `paths`: al menos un camino con su nombre');
      return {
        ...base,
        type: 'paths',
        mode: input.mode ?? 'alternate',
        paths: input.paths.map((p) => {
          const path = typeof p === 'string' ? { name: p } : p;
          if (!path.name?.trim()) throw new WorkspaceError('invalid-step', 'Cada camino necesita un nombre');
          return { name: path.name.trim(), steps: (path.steps ?? []).map((s) => buildStep(model, s, warnings, true) as LeafStep) };
        }),
      };
    }
    default:
      throw new WorkspaceError('invalid-step', `Tipo de paso desconocido "${String(input.type)}": usá ${STEP_TYPES.join(', ')}`);
  }
}

export interface CreateFlowInput {
  name: string;
  id?: string;
  description?: string;
  view?: string;
  steps?: StepInput[];
}

export function planCreateFlow(model: Model, input: CreateFlowInput): { op: Op; id: Id; warnings: string[] } {
  if (!input.name.trim()) throw new WorkspaceError('invalid-flow', 'El flujo necesita un nombre');
  const warnings: string[] = [];
  const id = input.id ?? newFlowId(model, input.name);
  const flow: Flow = {
    id,
    name: input.name.trim(),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    ...(input.view ? { view: view(model, input.view).id } : {}),
    steps: (input.steps ?? []).map((s) => buildStep(model, s, warnings)),
  };
  return { op: { type: 'flow.add', flow }, id, warnings };
}

/** `"5A"` → paso 5, camino A (índices desde 0). */
function parsePathRef(flow: Flow, ref: string): { top: number; path: number } {
  const m = /^\s*(\d+)\s*([A-Za-z])\s*$/.exec(ref);
  if (!m) throw new WorkspaceError('invalid-path', `Camino inválido "${ref}": indicá el número del paso y la letra del camino (ej. "5A")`);
  const top = Number(m[1]) - 1;
  const path = m[2]!.toUpperCase().charCodeAt(0) - 65;
  const step = flow.steps[top];
  if (!step) throw new WorkspaceError('not-found', `El flujo "${flow.name}" no tiene paso ${m[1]}`);
  if (step.type !== 'paths') throw new WorkspaceError('invalid-path', `El paso ${m[1]} de "${flow.name}" no es una bifurcación`);
  if (!step.paths[path]) throw new WorkspaceError('not-found', `El paso ${m[1]} de "${flow.name}" no tiene camino ${m[2]!.toUpperCase()}`);
  return { top, path };
}

export interface AddStepOptions {
  /** Camino donde agregarlo (`"5A"`); por defecto, al flujo. */
  path?: string;
  /** Posición (desde 1) en el flujo o en el camino; por defecto, al final. */
  position?: number;
}

/** Agrega un paso al flujo (o a un camino de una bifurcación). Devuelve el número que le toca. */
export function planAddFlowStep(model: Model, flowRef: string, input: StepInput, options: AddStepOptions = {}) {
  const flow = findFlow(model, flowRef);
  const warnings: string[] = [];
  const at = options.path ? parsePathRef(flow, options.path) : undefined;
  const step = buildStep(model, input, warnings, !!at);
  const insert = <T>(list: readonly T[], item: T): { list: T[]; index: number } => {
    const index = options.position === undefined ? list.length : Math.max(0, Math.min(Math.trunc(options.position) - 1, list.length));
    return { list: [...list.slice(0, index), item, ...list.slice(index)], index };
  };
  let steps: FlowStep[];
  let label: string;
  if (!at) {
    const r = insert(flow.steps, step);
    steps = r.list;
    label = stepLabel(r.index);
  } else {
    const top = flow.steps[at.top] as Extract<FlowStep, { type: 'paths' }>;
    const r = insert(top.paths[at.path]!.steps, step as LeafStep);
    steps = flow.steps.map((s, i) => (i === at.top ? { ...top, paths: top.paths.map((p, k) => (k === at.path ? { ...p, steps: r.list } : p)) } : s));
    label = stepLabel(at.top, at.path, r.index);
  }
  return { op: { type: 'flow.update', id: flow.id, patch: { steps } } as Op, flow, label, warnings };
}

export interface UpdateFlowInput {
  name?: string;
  description?: string | null;
  view?: string | null;
  /** Reemplaza la lista completa de pasos (para reordenar, editar o quitar). */
  steps?: StepInput[];
}

export function planUpdateFlow(model: Model, flowRef: string, input: UpdateFlowInput): { op: Op; flow: Flow; fields: string[]; warnings: string[] } {
  const flow = findFlow(model, flowRef);
  const warnings: string[] = [];
  const patch: FlowPatch = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.view !== undefined) patch.view = input.view ? view(model, input.view).id : null;
  if (input.steps !== undefined) patch.steps = input.steps.map((s) => buildStep(model, s, warnings));
  return { op: { type: 'flow.update', id: flow.id, patch }, flow, fields: Object.keys(patch), warnings };
}

/** Borra un flujo; avisa qué flujos saltaban a él (quedan con un paso roto). */
export function planDeleteFlow(model: Model, flowRef: string): { op: Op; flow: Flow; warnings: string[] } {
  const flow = findFlow(model, flowRef);
  const gotos = (s: FlowStep): boolean => (s.type === 'goto' && s.flow === flow.id) || (s.type === 'paths' && s.paths.some((p) => p.steps.some(gotos)));
  const callers = sortedValues(model.flows ?? {}).filter((f) => f.id !== flow.id && f.steps.some(gotos));
  const warnings = callers.map((f) => `El flujo "${f.name}" (${f.id}) tiene un paso que continúa en "${flow.name}": quedó apuntando a un flujo inexistente`);
  return { op: { type: 'flow.remove', id: flow.id }, flow, warnings };
}

// ---------------------------------------------------------------------------------------------
// Comentarios

export function findComment(model: Model, id: string): Comment {
  const comment = model.comments?.[id];
  if (!comment) throw new WorkspaceError('not-found', `No existe el comentario "${id}"`);
  return comment;
}

export type CommentStatus = 'open' | 'resolved' | 'all';

export interface CommentFilter {
  view?: string;
  element?: string;
  status?: CommentStatus;
}

/** Comentarios en orden cronológico, filtrados por lienzo, elemento anclado y estado. */
export function listComments(model: Model, filter: CommentFilter = {}): Comment[] {
  let items = Object.values(model.comments ?? {});
  if (filter.view) {
    const id = view(model, filter.view).id;
    items = items.filter((c) => c.view === id);
  }
  if (filter.element) {
    const id = element(model, filter.element).id;
    items = items.filter((c) => c.element === id);
  }
  if (filter.status === 'open') items = items.filter((c) => !c.resolved);
  if (filter.status === 'resolved') items = items.filter((c) => c.resolved);
  return items.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/** Comentario para listados: estado explícito y nombres del lienzo y del elemento. */
export function commentBrief(model: Model, c: Comment) {
  return {
    id: c.id,
    view: c.view,
    viewName: model.views[c.view]?.name ?? null,
    ...(c.element ? { element: c.element, elementName: model.elements[c.element]?.name ?? null } : {}),
    resolved: !!c.resolved,
    icon: c.icon ?? 'message',
    color: c.color ?? 'accent',
    ...(c.title ? { title: c.title } : {}),
    body: c.body,
    author: c.author,
    at: c.at,
    ...(c.edited ? { edited: c.edited } : {}),
    replies: c.replies ?? [],
  };
}

/** ID nuevo para un comentario (mismo formato que la app: `c-` + tiempo en base 36). */
export function newCommentId(model: Model, now = Date.now()): Id {
  for (;;) {
    const id = `c-${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    if (!model.comments?.[id]) return id;
  }
}

/** Lienzo "propio" de un elemento: el que muestra a sus hermanos (scope = su padre), si no el primero que lo tenga. */
function homeView(model: Model, el: Element): View | undefined {
  const views = viewsContaining(model, el.id);
  return views.find((v) => (v.scope ?? undefined) === el.parent) ?? views[0];
}

export interface AddCommentInput {
  body: string;
  author: string;
  view?: string;
  /** Elemento al que se ancla (se mueve con él); tiene que estar ubicado en el lienzo. */
  element?: string;
  x?: number;
  y?: number;
  title?: string;
  icon?: CommentIcon;
  color?: CommentColor;
  /** Fecha ISO (por defecto, ahora). */
  at?: string;
}

/**
 * Comentario nuevo. Sin `view` usa el lienzo propio del elemento. Sin posición, uno anclado va
 * en la esquina superior derecha del elemento y uno suelto a la derecha del contenido del
 * lienzo, corriéndose hacia abajo si ya hay otro comentario en ese lugar.
 */
export function planAddComment(model: Model, input: AddCommentInput): { op: Op; comment: Comment } {
  if (!input.body.trim()) throw new WorkspaceError('invalid-comment', 'El comentario necesita un texto (body)');
  if ((input.x === undefined) !== (input.y === undefined)) throw new WorkspaceError('invalid-position', 'Indicá x e y juntos');
  const el = input.element ? element(model, input.element) : undefined;
  const target = input.view ? view(model, input.view) : el ? homeView(model, el) : undefined;
  if (!target) {
    throw el
      ? new WorkspaceError('not-in-view', `"${el.name}" no está ubicado en ningún lienzo: indicá \`view\` o ubicalo primero`)
      : new WorkspaceError('invalid-comment', 'Indicá el lienzo (view) o el elemento (element) del comentario');
  }
  const node = el ? target.nodes[el.id] : undefined;
  if (el && !node) throw new WorkspaceError('not-in-view', `"${el.name}" no está ubicado en el lienzo ${target.id}`);

  let pos: { x: number; y: number };
  if (input.x !== undefined && input.y !== undefined) pos = { x: Math.round(input.x), y: Math.round(input.y) };
  else {
    if (el && node) pos = { x: sizeOf(el, node).w - 24, y: -14 };
    else {
      const boxes = Object.entries(target.nodes)
        .filter(([id]) => model.elements[id])
        .map(([id, l]) => ({ x: l.x, y: l.y, w: sizeOf(model.elements[id]!, l).w }));
      pos = boxes.length ? { x: Math.max(...boxes.map((b) => b.x + b.w)) + 40, y: Math.min(...boxes.map((b) => b.y)) } : { x: 0, y: 0 };
    }
    const taken = (p: { x: number; y: number }) =>
      Object.values(model.comments ?? {}).some((c) => c.view === target.id && (c.element ?? null) === (el?.id ?? null) && c.x === p.x && c.y === p.y);
    while (taken(pos)) pos = { x: pos.x, y: pos.y + 40 };
  }

  const comment: Comment = {
    id: newCommentId(model),
    view: target.id,
    ...(el ? { element: el.id } : {}),
    ...pos,
    ...(input.icon && input.icon !== 'message' ? { icon: input.icon } : {}),
    ...(input.color && input.color !== 'accent' ? { color: input.color } : {}),
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    body: input.body.trim(),
    author: input.author.trim(),
    at: input.at ?? new Date().toISOString(),
  };
  return { op: { type: 'comment.add', comment }, comment };
}

export function planReplyComment(model: Model, id: string, reply: { body: string; author: string; at?: string }): { op: Op; comment: Comment } {
  const comment = findComment(model, id);
  if (!reply.body.trim()) throw new WorkspaceError('invalid-comment', 'La respuesta necesita un texto (body)');
  const replies = [...(comment.replies ?? []), { author: reply.author.trim(), at: reply.at ?? new Date().toISOString(), body: reply.body.trim() }];
  return { op: { type: 'comment.update', id: comment.id, patch: { replies } }, comment };
}

/** Resuelve (o reabre) un comentario. `op` es null si ya estaba en ese estado. */
export function planResolveComment(model: Model, id: string, resolved: boolean): { op: Op | null; comment: Comment } {
  const comment = findComment(model, id);
  if (!!comment.resolved === resolved) return { op: null, comment };
  const patch: CommentPatch = { resolved: resolved ? true : null };
  return { op: { type: 'comment.update', id: comment.id, patch }, comment };
}
