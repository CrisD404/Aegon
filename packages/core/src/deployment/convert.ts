import { uniqueId } from '../ids/index.ts';
import { descendantsOf, indexOf, sortedValues, type Model } from '../model/index.ts';
import type { Op } from '../ops/index.ts';
import { newElement, newInstance, sizeOf } from '../ops/commands.ts';
import type { Element, Id, NodeLayout, NodeType, View } from '../schema/index.ts';
import { inEnvironment, instancesOf } from './index.ts';

/**
 * En un lienzo de despliegue el software lleva dirección, puertos y réplicas solo cuando es una
 * **instancia**; un servidor, una VM o una red son **nodos**. Esto arma las dos cosas sin que la
 * persona tenga que conocer la diferencia de antemano: crear software ya desplegado, y convertir
 * lo que quedó puesto como sistema en lo que en realidad es.
 */

/** Nodo de despliegue del lienzo (el más chico) que contiene el punto. */
export function nodeFrameAt(model: Model, view: View, point: { x: number; y: number }, except: ReadonlySet<Id> = new Set()): Id | undefined {
  let best: { id: Id; area: number } | undefined;
  for (const [id, layout] of Object.entries(view.nodes)) {
    const el = model.elements[id];
    if (!el || el.kind !== 'node' || except.has(id)) continue;
    const s = sizeOf(el, layout);
    if (point.x < layout.x || point.x > layout.x + s.w || point.y < layout.y || point.y > layout.y + s.h) continue;
    const area = s.w * s.h;
    if (!best || area < best.area) best = { id, area };
  }
  return best?.id;
}

/** Qué software se crea desplegado: un servicio o aplicación, una base de datos o un bus. */
export type DeployedSoftware = 'service' | 'store' | 'bus';

/**
 * Software que nace desplegado. Crea a la vez el elemento lógico (un contenedor del sistema del
 * lienzo, o un sistema si el lienzo no es de ninguno) y su instancia en el ambiente del lienzo,
 * dentro del nodo donde cae el punto. La instancia es la que lleva direcciones y réplicas.
 */
export function createDeployedOp(
  model: Model,
  viewId: Id,
  input: { what: DeployedSoftware; name: string; at: { x: number; y: number }; fields?: Partial<Element>; parent?: Id | null },
): { op: Op; id: Id; of: Id } | null {
  const view = model.views[viewId];
  if (!view || view.level !== 'deployment') return null;
  const scope = view.scope && model.elements[view.scope]?.kind === 'system' ? view.scope : undefined;
  const kind = input.what === 'service' ? (scope ? 'container' : 'system') : input.what;
  const fields: Partial<Element> = { ...input.fields };
  if (scope) fields.parent = scope;
  const logical = newElement(model, kind, input.name, fields);
  const size = sizeOf({ kind: 'instance' });
  const pos = { x: Math.round(input.at.x - size.w / 2), y: Math.round(input.at.y - size.h / 2) };
  // Quien llama puede haber corrido el punto para no pisar nada: ahí indica el nodo que eligió la persona.
  const parent = input.parent === undefined ? nodeFrameAt(model, view, input.at) : (input.parent ?? undefined);
  const id = uniqueId(view.environment ? `${logical.id}-${view.environment}` : `${logical.id}-instancia`, (x) => !!model.elements[x] || x === logical.id);
  const instance = {
    id,
    kind: 'instance',
    name: logical.name,
    instance: { of: logical.id },
    ...(parent ? { parent } : {}),
    ...(view.environment ? { environments: [view.environment] } : {}),
  } as Element;
  return {
    op: {
      type: 'batch',
      label: `Agregar ${logical.name}`,
      ops: [
        { type: 'element.add', element: logical },
        { type: 'element.add', element: instance },
        { type: 'view.place', view: view.id, nodes: { [id]: pos } },
      ],
    },
    id,
    of: logical.id,
  };
}

/** Sistemas propios que el lienzo de despliegue tiene puestos directo: sin instancia no llevan dirección ni réplicas. */
export function directSystemsIn(model: Model, view: View): Element[] {
  if (view.level !== 'deployment') return [];
  return Object.keys(view.nodes)
    .map((id) => model.elements[id])
    .filter((el): el is Element => !!el && el.kind === 'system' && el.scope !== 'external')
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
}

/**
 * Pasa sistemas puestos directo en el lienzo a instancias suyas (el sistema sigue en el modelo):
 * quedan en el mismo lugar y con el mismo tamaño, dentro del nodo que los contiene, y ya aceptan
 * direcciones y réplicas. Nada más del lienzo se mueve ni cambia de tamaño.
 * Las relaciones de red (con nodos, infraestructura u otras instancias) pasan a la instancia; las
 * lógicas quedan en el sistema y el lienzo las proyecta.
 */
export function convertToInstanceOp(model: Model, viewId: Id, ids: readonly Id[]): { op: Op; ids: Id[] } | null {
  const view = model.views[viewId];
  if (!view || view.level !== 'deployment') return null;
  const idx = indexOf(model);
  const ops: Op[] = [];
  const out: Id[] = [];
  const created: Id[] = [];
  const placed: Record<Id, NodeLayout> = {};
  const repoint: Op[] = [];
  for (const id of ids) {
    const el = model.elements[id];
    const layout = view.nodes[id];
    if (!el || el.kind !== 'system' || !layout || out.includes(id)) continue;
    const size = sizeOf(el, layout);
    const parent = nodeFrameAt(model, view, { x: layout.x + size.w / 2, y: layout.y + size.h / 2 });
    const inst = newInstance(model, id, { parent, environment: view.environment });
    ops.push({ type: 'element.add', element: inst });
    // El tamaño que se le había dado a mano también se conserva.
    placed[inst.id] = { ...layout };
    out.push(id);
    created.push(inst.id);
    for (const r of [...(idx.relationsFrom.get(id) ?? []), ...(idx.relationsTo.get(id) ?? [])]) {
      const rel = model.relations[r];
      if (!rel) continue;
      const other = model.elements[rel.from === id ? rel.to : rel.from];
      if (!other || !(other.kind === 'node' || other.kind === 'infra' || other.kind === 'instance')) continue;
      repoint.push({ type: 'relation.update', id: r, patch: rel.from === id ? { from: inst.id } : { to: inst.id } });
    }
  }
  if (!created.length) return null;
  ops.push({ type: 'view.unplace', view: view.id, ids: out }, { type: 'view.place', view: view.id, nodes: placed }, ...repoint);
  const label = created.length === 1 ? `Convertir ${model.elements[out[0]!]!.name} en instancia` : `Convertir ${created.length} en instancias`;
  return { op: { type: 'batch', ops, label }, ids: created };
}

/**
 * Por qué un sistema no se puede convertir en nodo, o null si se puede. Un nodo es un equipo o un
 * lugar (servidor, VM, red); si el sistema ya se usa como software, lo que corresponde es una instancia.
 */
export function nodeConversionProblem(model: Model, id: Id): string | null {
  const el = model.elements[id];
  if (!el || el.kind !== 'system') return 'Solo se convierte un sistema';
  if (descendantsOf(model, id).length) return `"${el.name}" tiene contenedores: es software. Convertilo en instancia`;
  if (instancesOf(model, id).length) return `"${el.name}" ya está desplegado como software en otro lado`;
  const idx = indexOf(model);
  if ((idx.viewsByScope.get(id) ?? []).length) return `"${el.name}" tiene su propio lienzo de detalle: es software`;
  const c4 = (idx.viewsContaining.get(id) ?? []).map((v) => model.views[v]).find((v) => v && v.level !== 'deployment');
  if (c4) return `"${el.name}" está en el lienzo ${c4.name}: es software. Convertilo en instancia`;
  if ((idx.membersOf.get(id) ?? []).length) return `"${el.name}" tiene miembros`;
  return null;
}

/**
 * Convierte sistemas que en realidad son equipos (un servidor, una VM) en nodos de despliegue, con
 * el mismo ID, nombre, descripción, relaciones, lugar y tamaño en cada lienzo. Ahí ya llevan
 * dirección de red y pueden alojar instancias. Los que no se pueden convertir se devuelven en `skipped`.
 *
 * El nodo ocupa exactamente el rectángulo que ocupaba el sistema (un nodo sin tamaño propio sería
 * un marco grande): así no pisa a los vecinos ni obliga a agrandar los marcos que lo contienen.
 * Crece solo cuando después se le pone algo adentro.
 */
export function convertToNodeOp(
  model: Model,
  viewId: Id,
  ids: readonly Id[],
  type: NodeType = 'server',
): { op: Op | null; ids: Id[]; skipped: { id: Id; reason: string }[] } | null {
  const view = model.views[viewId];
  if (!view || view.level !== 'deployment') return null;
  const idx = indexOf(model);
  const ops: Op[] = [];
  const done: Id[] = [];
  const skipped: { id: Id; reason: string }[] = [];
  const relations = new Map<Id, Model['relations'][Id]>();
  const targets = [...new Set(ids)].filter((id) => model.elements[id]?.kind === 'system' && view.nodes[id]);
  for (const id of targets) {
    const reason = nodeConversionProblem(model, id);
    if (reason) skipped.push({ id, reason });
    else done.push(id);
  }
  if (!done.length) return skipped.length ? { op: null, ids: [], skipped } : null;
  const converting = new Set(done);

  // 1. Lo que la baja del sistema se lleva y hay que reponer: relaciones, su trazo y su lugar en cada lienzo.
  const edgeStyles: Op[] = [];
  const places = new Map<Id, Record<Id, NodeLayout>>();
  for (const id of done) {
    for (const r of [...(idx.relationsFrom.get(id) ?? []), ...(idx.relationsTo.get(id) ?? [])]) {
      const rel = model.relations[r];
      if (rel) relations.set(r, rel);
    }
    for (const v of idx.viewsContaining.get(id) ?? []) {
      const layout = model.views[v]?.nodes[id];
      if (!layout) continue;
      places.set(v, { ...(places.get(v) ?? {}), [id]: { x: layout.x, y: layout.y, ...sizeOf(model.elements[id]!, layout) } });
    }
  }
  for (const v of sortedValues(model.views)) {
    for (const [r, style] of Object.entries(v.edges ?? {})) {
      if (relations.has(r)) edgeStyles.push({ type: 'view.edge', view: v.id, relation: r, style });
    }
  }

  // 2. Baja de cada sistema y alta del nodo con el mismo ID. El nodo queda dentro del nodo del
  // lienzo que lo contiene (los que se convierten en este mismo paso no cuentan como contenedores).
  for (const id of done) ops.push({ type: 'element.remove', id });
  for (const id of done) {
    const el = model.elements[id]!;
    const layout = view.nodes[id]!;
    const size = sizeOf(el, layout);
    const parent = nodeFrameAt(model, view, { x: layout.x + size.w / 2, y: layout.y + size.h / 2 }, converting);
    const node: Record<string, unknown> = { id, kind: 'node', name: el.name, node: { type } };
    for (const key of ['description', 'docs', 'status', 'tags', 'links', 'owner', 'properties', 'extensions', 'technology'] as const) {
      const value = (el as Record<string, unknown>)[key];
      if (value !== undefined) node[key] = value;
    }
    if (parent) node.parent = parent;
    if (el.environments) node.environments = el.environments;
    else if (view.environment) node.environments = [view.environment];
    ops.push({ type: 'element.add', element: node as unknown as Element });
  }
  for (const rel of [...relations.values()].sort((a, b) => a.id.localeCompare(b.id))) ops.push({ type: 'relation.add', relation: rel });
  for (const [v, nodes] of [...places].sort(([a], [b]) => a.localeCompare(b))) ops.push({ type: 'view.place', view: v, nodes });
  ops.push(...edgeStyles);

  const label = done.length === 1 ? `Convertir ${model.elements[done[0]!]!.name} en nodo` : `Convertir ${done.length} en nodos`;
  return { op: { type: 'batch', ops, label }, ids: done, skipped };
}

const DETAIL_GAP = { x: 40, y: 32 } as const;

/** Contenedores, bases y buses de un sistema que todavía no tienen instancia en el ambiente. */
export function undeployedPartsOf(model: Model, system: Id, env: Id | undefined): Element[] {
  return descendantsOf(model, system)
    .map((id) => model.elements[id])
    .filter((el): el is Element => !!el && (el.kind === 'container' || el.kind === 'store' || el.kind === 'bus'))
    .filter((el) => inEnvironment(el, env) && !instancesOf(model, el.id, env).length)
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
}

/**
 * Detalla un sistema del lienzo de despliegue (su instancia, o el sistema puesto directo) en lo
 * que lo compone: una instancia de cada contenedor, base y bus que falte en el ambiente, en
 * grilla desde donde estaba, cada una con su propia dirección. El sistema sale del lienzo.
 */
export function detailInstanceOp(model: Model, viewId: Id, id: Id): { op: Op; ids: Id[] } | null {
  const view = model.views[viewId];
  const el = model.elements[id];
  const layout = view?.nodes[id];
  if (!view || view.level !== 'deployment' || !el || !layout) return null;
  const system = el.kind === 'instance' ? model.elements[el.instance.of] : el;
  if (!system || system.kind !== 'system') return null;
  const parts = undeployedPartsOf(model, system.id, view.environment);
  if (!parts.length) return null;
  const size = sizeOf({ kind: 'instance' });
  const parent = el.kind === 'instance' ? el.parent : nodeFrameAt(model, view, { x: layout.x + size.w / 2, y: layout.y + size.h / 2 });
  const cols = Math.max(1, Math.ceil(Math.sqrt(parts.length)));
  const ops: Op[] = [];
  const placed: Record<Id, NodeLayout> = {};
  const created: Id[] = [];
  parts.forEach((part, i) => {
    const inst = newInstance(model, part.id, { parent, environment: view.environment });
    ops.push({ type: 'element.add', element: inst });
    placed[inst.id] = { x: layout.x + (i % cols) * (size.w + DETAIL_GAP.x), y: layout.y + Math.floor(i / cols) * (size.h + DETAIL_GAP.y) };
    created.push(inst.id);
  });
  // La instancia del sistema ya no hace falta (sus partes la reemplazan); el sistema puesto directo solo sale del lienzo.
  if (el.kind === 'instance') ops.push({ type: 'element.remove', id });
  else ops.push({ type: 'view.unplace', view: view.id, ids: [id] });
  ops.push({ type: 'view.place', view: view.id, nodes: placed });
  return { op: { type: 'batch', ops, label: `Detallar ${system.name}` }, ids: created };
}
