import { uniqueId, relationIdFor } from '../ids/index.ts';
import { ancestorsOf, descendantsOf, sortedValues, type Model } from '../model/index.ts';
import type { Op } from '../ops/index.ts';
import { deploymentViewName, newInstance, relationBetween, sizeOf } from '../ops/commands.ts';
import { FRAME_PADDING, bounds, visualParentOf, type Rect } from '../layout/index.ts';
import type { Element, Environment, Id, NodeLayout, Relation, View } from '../schema/index.ts';
import { hostNodeOf, inEnvironment, isDeploymentKind, isNetworkRelation, systemsInPlay, undeployedIn } from './index.ts';

/**
 * Armar un despliegue sin partir de cero: desplegar de una vez todo lo que falta y copiar el
 * despliegue de un ambiente a otro. Devuelven `Op`s, así la app, la CLI y el MCP hacen lo mismo.
 */

/** Lienzo de despliegue de cada ambiente para un sistema (o para los lienzos sin sistema). */
export function deploymentViewsByEnvironment(model: Model, scope: Id | undefined): Map<Id, View> {
  const out = new Map<Id, View>();
  for (const view of sortedValues(model.views)) {
    if (view.level !== 'deployment' || !view.environment || view.scope !== scope) continue;
    if (!out.has(view.environment)) out.set(view.environment, view);
  }
  return out;
}

/** Lo que falta desplegar en el ambiente de un lienzo (de su sistema, o de los que ya tienen algo ahí). */
export function undeployedInView(model: Model, view: View): Element[] {
  if (view.level !== 'deployment' || !view.environment) return [];
  return undeployedIn(model, view.environment, view.scope ? [view.scope] : systemsInPlay(model, view.environment));
}

/** Aire entre instancias: entran las etiquetas de las relaciones que el lienzo proyecta entre ellas. */
/** Cómo está algo en un ambiente: desplegado (réplicas y dónde), sin desplegar o no existe ahí. */
export type DeploymentCell =
  | { state: 'deployed'; replicas: number; nodes: string[] }
  | { state: 'missing' }
  | { state: 'absent' };

export interface DeploymentMatrix {
  /** Ambientes que tienen algo desplegado o un lienzo de despliegue, en el orden del workspace. */
  environments: Environment[];
  rows: { element: Element; cells: Record<Id, DeploymentCell> }[];
}

/**
 * Comparación entre ambientes: por cada contenedor, base y bus del sistema (o de todos los que
 * tienen despliegue), cuántas réplicas corren en cada ambiente y en qué nodo, o si falta.
 */
export function deploymentMatrix(model: Model, scope?: Id): DeploymentMatrix {
  const instances = sortedValues(model.elements).filter((el) => el.kind === 'instance');
  const environments = (model.workspace.environments ?? []).filter(
    (env) =>
      sortedValues(model.views).some((v) => v.level === 'deployment' && v.environment === env.id && (!scope || v.scope === scope)) ||
      instances.some((i) => i.environments?.includes(env.id)),
  );
  const systems = scope ? [scope] : [...new Set(environments.flatMap((env) => systemsInPlay(model, env.id)))];
  const rows: DeploymentMatrix['rows'] = [];
  const seen = new Set<Id>();
  for (const sys of systems) {
    for (const id of descendantsOf(model, sys)) {
      const el = model.elements[id];
      if (!el || seen.has(id) || !(el.kind === 'container' || el.kind === 'store' || el.kind === 'bus')) continue;
      seen.add(id);
      const cells: Record<Id, DeploymentCell> = {};
      for (const env of environments) {
        if (!inEnvironment(el, env.id)) {
          cells[env.id] = { state: 'absent' };
          continue;
        }
        const own = instances.filter((i) => i.kind === 'instance' && i.instance.of === id && inEnvironment(i, env.id));
        if (!own.length) {
          cells[env.id] = { state: 'missing' };
          continue;
        }
        const replicas = own.reduce((sum, i) => sum + (i.kind === 'instance' ? (i.instance.replicas ?? 1) : 0), 0);
        const nodes = [...new Set(own.map((i) => hostNodeOf(model, i.id)?.name).filter((n): n is string => !!n))];
        cells[env.id] = { state: 'deployed', replicas, nodes };
      }
      rows.push({ element: el, cells });
    }
  }
  rows.sort((a, b) => a.element.name.localeCompare(b.element.name, 'es', { numeric: true }));
  return { environments, rows };
}

const GRID_GAP = { x: 104, y: 80 } as const;

/**
 * Despliega de una vez todo lo que falta en el ambiente del lienzo: una instancia de cada
 * contenedor, base y bus, en grilla dentro de `into` (un nodo del lienzo) o, si no se indica, de
 * un nodo nuevo con el nombre del ambiente que después se renombra y se tipa. Null si no falta nada.
 */
export function deployAllOp(model: Model, viewId: Id, into?: Id): { op: Op; ids: Id[]; node: Id } | null {
  const view = model.views[viewId];
  if (!view || view.level !== 'deployment' || !view.environment) return null;
  const missing = undeployedInView(model, view);
  if (!missing.length) return null;
  const env = view.environment;
  const envName = model.workspace.environments?.find((e) => e.id === env)?.name ?? env;
  const ops: Op[] = [];
  const placed: Record<Id, NodeLayout> = {};

  // 1. El nodo que las aloja.
  let host = into && view.nodes[into] && model.elements[into]?.kind === 'node' ? into : undefined;
  let frame: Rect;
  let innerBottom: number | null = null;
  if (host) {
    const el = model.elements[host]!;
    frame = { x: view.nodes[host]!.x, y: view.nodes[host]!.y, ...sizeOf(el, view.nodes[host]) };
    const inside = Object.entries(view.nodes)
      .filter(([id]) => id !== host && model.elements[id] && visualParentOf(model, view, model.elements[id]!) === host)
      .map(([id, l]) => ({ x: l.x, y: l.y, ...sizeOf(model.elements[id]!, l) }));
    const box = bounds(inside);
    if (box) innerBottom = box.y + box.h;
  } else {
    host = uniqueId(`ambiente-${env}`, (id) => !!model.elements[id]);
    ops.push({ type: 'element.add', element: { id: host, kind: 'node', name: `Ambiente ${envName}`, node: { type: 'other' }, environments: [env] } });
    const all = bounds(
      Object.entries(view.nodes)
        .filter(([id]) => model.elements[id])
        .map(([id, l]) => ({ x: l.x, y: l.y, ...sizeOf(model.elements[id]!, l) })),
    );
    frame = { x: all ? Math.round(all.x + all.w + 100) : 0, y: all ? Math.round(all.y) : 0, w: 0, h: 0 };
  }

  // 2. Las instancias, en grilla debajo de lo que el nodo ya tenía.
  const instances = missing.map((el) => newInstance(model, el.id, { parent: host, environment: env }));
  const size = sizeOf(instances[0]!);
  const cols = Math.max(1, Math.ceil(Math.sqrt(instances.length)));
  const startX = frame.x + FRAME_PADDING.side;
  const startY = innerBottom !== null ? innerBottom + GRID_GAP.y : frame.y + FRAME_PADDING.top;
  instances.forEach((inst, i) => {
    ops.push({ type: 'element.add', element: inst });
    placed[inst.id] = { x: Math.round(startX + (i % cols) * (size.w + GRID_GAP.x)), y: Math.round(startY + Math.floor(i / cols) * (size.h + GRID_GAP.y)) };
  });
  const rows = Math.ceil(instances.length / cols);
  const needRight = startX + cols * size.w + (cols - 1) * GRID_GAP.x + FRAME_PADDING.side;
  const needBottom = startY + rows * size.h + (rows - 1) * GRID_GAP.y + FRAME_PADDING.bottom;
  const grown: Rect = { x: frame.x, y: frame.y, w: Math.max(frame.w, needRight - frame.x), h: Math.max(frame.h, needBottom - frame.y) };
  placed[host] = { x: Math.round(grown.x), y: Math.round(grown.y), w: Math.round(grown.w), h: Math.round(grown.h) };

  // 3. Los nodos que contienen al que creció también crecen para seguir envolviéndolo.
  let child = grown;
  let current = model.elements[host] ? visualParentOf(model, view, model.elements[host]!) : undefined;
  const seen = new Set<Id>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const el = model.elements[current]!;
    const r = { x: view.nodes[current]!.x, y: view.nodes[current]!.y, ...sizeOf(el, view.nodes[current]) };
    const next: Rect = {
      x: r.x,
      y: r.y,
      w: Math.max(r.w, child.x + child.w + FRAME_PADDING.side - r.x),
      h: Math.max(r.h, child.y + child.h + FRAME_PADDING.bottom - r.y),
    };
    if (next.w === r.w && next.h === r.h) break;
    placed[current] = { x: Math.round(next.x), y: Math.round(next.y), w: Math.round(next.w), h: Math.round(next.h) };
    child = next;
    current = visualParentOf(model, view, el);
  }

  ops.push({ type: 'view.place', view: viewId, nodes: placed });
  return { op: { type: 'batch', ops, label: `Desplegar todo en ${envName}` }, ids: instances.map((i) => i.id), node: host };
}

/** Cambia el ambiente dentro de un ID (`vpc-prod` → `vpc-qa`); si no lo lleva, lo agrega al final. */
function idFor(id: Id, from: Id, to: Id): Id {
  if (id.endsWith(`-${from}`)) return `${id.slice(0, -from.length)}${to}`;
  if (id.startsWith(`${from}-`)) return `${to}${id.slice(from.length)}`;
  return `${id}-${to}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Copia un lienzo de despliegue a otro ambiente: lo que es propio del ambiente de origen (nodos,
 * infraestructura, instancias) se duplica para el nuevo, con la misma disposición; lo compartido
 * (un datacenter que vale para todos, un actor, un sistema externo) se reutiliza. Las direcciones,
 * los IDs de recursos y la cuenta no se copian: son de cada ambiente. Las réplicas salen de los
 * costos cargados para el ambiente nuevo, si los hay.
 *
 * Null si el sistema ya tiene un lienzo de despliegue en ese ambiente.
 */
export function copyDeploymentOp(model: Model, viewId: Id, toEnv: Id): { op: Op; viewId: Id; copied: number } | null {
  const view = model.views[viewId];
  if (!view || view.level !== 'deployment' || !view.environment || view.environment === toEnv) return null;
  if (deploymentViewsByEnvironment(model, view.scope).has(toEnv)) return null;
  const fromEnv = view.environment;
  const envs = model.workspace.environments ?? [];
  const fromName = envs.find((e) => e.id === fromEnv)?.name ?? fromEnv;
  const toName = envs.find((e) => e.id === toEnv)?.name ?? toEnv;
  const rename = (name: string) => name.replace(new RegExp(escapeRegExp(fromName), 'gi'), toName);

  // De afuera hacia adentro: un nodo se copia antes que lo que contiene.
  const depth = (id: Id) => ancestorsOf(model, id).length;
  const placed = Object.keys(view.nodes)
    .filter((id) => model.elements[id])
    .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));

  const mapping = new Map<Id, Id>();
  const taken = new Set(Object.keys(model.elements));
  const ops: Op[] = [];
  let copied = 0;
  for (const id of placed) {
    const el = model.elements[id]!;
    // Lo que no es de un ambiente (o ya vale también para el nuevo) se comparte.
    if (!isDeploymentKind(el.kind) || inEnvironment(el, toEnv)) {
      mapping.set(id, id);
      continue;
    }
    // Una instancia de algo que no existe en el ambiente nuevo no se copia.
    if (el.kind === 'instance') {
      const target = model.elements[el.instance.of];
      if (!target || !inEnvironment(target, toEnv)) continue;
    }
    // Si su nodo no pasó (no se copió ni se comparte), queda suelto: mejor no copiarlo.
    if (el.parent && model.elements[el.parent] && view.nodes[el.parent] && !mapping.has(el.parent)) continue;

    const newId = uniqueId(idFor(id, fromEnv, toEnv), (x) => taken.has(x));
    taken.add(newId);
    mapping.set(id, newId);
    const next: Record<string, unknown> = { ...el, id: newId, name: rename(el.name), environments: [toEnv] };
    delete next.addresses;
    delete next.resource;
    delete next.finops;
    if (el.parent && mapping.has(el.parent)) next.parent = mapping.get(el.parent);
    if (el.kind === 'node' && el.node.account) {
      const { account: _account, ...node } = el.node;
      next.node = node;
    }
    if (el.kind === 'instance') {
      const replicas = model.elements[el.instance.of]?.finops?.costs?.[toEnv]?.replicas;
      next.instance = replicas && replicas > 1 ? { of: el.instance.of, replicas } : { of: el.instance.of };
    }
    ops.push({ type: 'element.add', element: next as unknown as Element });
    copied++;
  }

  // Un nodo que en el origen alojaba algo y en el ambiente nuevo queda vacío (lo que tenía no
  // existe ahí) no se copia: sería un marco sin nada. Los que ya estaban vacíos sí, son estructura.
  const dropped = new Set<Id>();
  for (const id of [...placed].reverse()) {
    const el = model.elements[id]!;
    if (el.kind !== 'node' || mapping.get(id) === id || !mapping.has(id)) continue;
    const kids = placed.filter((c) => model.elements[c]!.parent === id);
    if (kids.length && kids.every((c) => !mapping.has(c))) {
      dropped.add(mapping.get(id)!);
      mapping.delete(id);
      copied--;
    }
  }
  if (dropped.size) {
    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i]!;
      if (op.type === 'element.add' && dropped.has(op.element.id)) ops.splice(i, 1);
    }
  }

  // Los tramos de red entre lo copiado (y hacia lo compartido).
  const relTaken = new Set(Object.keys(model.relations));
  const pairs = new Set<string>();
  for (const rel of sortedValues(model.relations)) {
    const from = mapping.get(rel.from);
    const to = mapping.get(rel.to);
    if (!from || !to || (from === rel.from && to === rel.to) || !isNetworkRelation(model, rel)) continue;
    const pair = [from, to].sort().join('|');
    if (pairs.has(pair) || relationBetween(model, from, to)) continue;
    pairs.add(pair);
    const id = relationIdFor(from, to, (r) => relTaken.has(r));
    relTaken.add(id);
    const { id: _id, from: _from, to: _to, ...rest } = rel;
    ops.push({ type: 'relation.add', relation: { ...rest, id, from, to } as Relation });
  }

  const nodes: Record<Id, NodeLayout> = {};
  for (const [id, layout] of Object.entries(view.nodes)) {
    const mapped = mapping.get(id);
    if (mapped) nodes[mapped] = { ...layout };
  }
  const name = deploymentViewName(model, toEnv, view.scope);
  const newViewId = uniqueId(idFor(view.id, fromEnv, toEnv), (v) => !!model.views[v]);
  const next: View = { id: newViewId, name, level: 'deployment', environment: toEnv, nodes };
  if (view.scope) next.scope = view.scope;
  ops.push({ type: 'view.add', view: next });
  return { op: { type: 'batch', ops, label: `Copiar el despliegue a ${toName}` }, viewId: newViewId, copied };
}
