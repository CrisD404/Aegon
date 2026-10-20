import { ancestorsOf, sortedValues, type Model } from '../model/index.ts';
import { DEPLOYMENT_KINDS, type Element, type ElementKind, type Id, type Relation, type View } from '../schema/index.ts';
import { representativeInView, type ViewEdge } from '../ops/commands.ts';

/**
 * Despliegue (C4 deployment diagram): nodos que anidan infraestructura e instancias de
 * contenedores por ambiente.
 *
 * Las relaciones lógicas (contenedor → contenedor, actor → contenedor) no se repiten en el
 * despliegue: se proyectan sobre las instancias del lienzo. Si el lienzo ya muestra un camino de
 * red explícito entre esas instancias (actor → firewall → balanceador → pod), la proyección se
 * omite: el camino ya cuenta esa relación y el diagrama queda sin líneas duplicadas.
 */

export function isDeploymentKind(kind: ElementKind): kind is (typeof DEPLOYMENT_KINDS)[number] {
  return (DEPLOYMENT_KINDS as readonly string[]).includes(kind);
}

/** El elemento vale para ese ambiente (sin `environments`, vale para todos). */
export function inEnvironment(el: Pick<Element, 'environments'>, env: Id | undefined): boolean {
  return !env || !el.environments || el.environments.includes(env);
}

/** Elemento desplegado por una instancia (o undefined si no es una instancia válida). */
export function deployedElement(model: Model, el: Element | undefined): Element | undefined {
  return el?.kind === 'instance' ? model.elements[el.instance.of] : undefined;
}

/** Instancias de un elemento (en un ambiente, si se indica). */
export function instancesOf(model: Model, id: Id, env?: Id): Element[] {
  return sortedValues(model.elements).filter((el) => el.kind === 'instance' && el.instance.of === id && inEnvironment(el, env));
}

/** Nodo de despliegue más cercano que contiene al elemento. */
export function hostNodeOf(model: Model, id: Id): Element | undefined {
  return ancestorsOf(model, id).find((a) => a.kind === 'node');
}

/**
 * Nodos del lienzo que representan a un elemento lógico: él mismo si está ubicado (actor,
 * sistema externo) o las instancias del lienzo que lo despliegan a él o a un ancestro suyo (un
 * componente corre dentro de la instancia de su contenedor). Si una instancia está dentro de un
 * nodo colapsado (no ubicado), la representa ese nodo.
 */
function logicalRepresentatives(model: Model, view: View, id: Id, byTarget: ReadonlyMap<Id, Id[]>): Id[] {
  if (view.nodes[id]) return [id];
  const chain = [id, ...ancestorsOf(model, id).map((a) => a.id)];
  const out = new Set<Id>();
  for (const target of chain) {
    for (const inst of byTarget.get(target) ?? []) {
      const rep = representativeInView(model, view, inst);
      if (rep) out.add(rep);
    }
    if (out.size) break;
  }
  return [...out];
}

/** ¿El elemento ya tiene un camino explícito en el lienzo de `from` a `to` (o a lo que contiene a `to`)? */
function hasPath(model: Model, adjacency: ReadonlyMap<Id, Id[]>, from: Id, to: Id): boolean {
  const goals = new Set<Id>([to, ...ancestorsOf(model, to).map((a) => a.id)]);
  const start = [from, ...ancestorsOf(model, from).map((a) => a.id)].filter((id) => adjacency.has(id));
  const seen = new Set<Id>(start);
  const queue = [...start];
  while (queue.length) {
    const next = queue.shift()!;
    for (const n of adjacency.get(next) ?? []) {
      if (goals.has(n)) return true;
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return false;
}

/**
 * Relaciones lógicas proyectadas sobre un lienzo de despliegue, una por par de nodos. `explicit`
 * son las relaciones que el lienzo ya dibuja (las de `viewEdges`).
 */
export function projectedEdges(model: Model, view: View, explicit: readonly ViewEdge[]): ViewEdge[] {
  if (view.level !== 'deployment') return [];
  const byTarget = new Map<Id, Id[]>();
  for (const id of Object.keys(view.nodes)) {
    const el = model.elements[id];
    if (el?.kind !== 'instance') continue;
    byTarget.set(el.instance.of, [...(byTarget.get(el.instance.of) ?? []), id]);
  }
  // También las instancias de nodos colapsados (no ubicadas, pero con un ancestro ubicado).
  for (const el of Object.values(model.elements)) {
    if (el.kind !== 'instance' || view.nodes[el.id] || !inEnvironment(el, view.environment)) continue;
    if (!representativeInView(model, view, el.id)) continue;
    byTarget.set(el.instance.of, [...(byTarget.get(el.instance.of) ?? []), el.id]);
  }
  if (!byTarget.size) return [];

  const adjacency = new Map<Id, Id[]>();
  const link = (a: Id, b: Id) => adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
  const explicitPairs = new Set<string>();
  const pairKey = (a: Id, b: Id) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const e of explicit) {
    link(e.from, e.to);
    if (e.bidirectional) link(e.to, e.from);
    explicitPairs.add(pairKey(e.from, e.to));
  }

  const out = new Map<string, ViewEdge>();
  for (const rel of sortedValues(model.relations)) {
    if (view.edges?.[rel.id]?.hidden) continue;
    const from = model.elements[rel.from];
    const to = model.elements[rel.to];
    if (!from || !to || isDeploymentKind(from.kind) || isDeploymentKind(to.kind)) continue;
    if (from.kind === 'group' || to.kind === 'group') continue;
    // Las dos puntas ubicadas tal cual: ya es una relación explícita del lienzo.
    if (view.nodes[rel.from] && view.nodes[rel.to]) continue;
    const sources = logicalRepresentatives(model, view, rel.from, byTarget);
    const targets = logicalRepresentatives(model, view, rel.to, byTarget);
    for (const a of sources) {
      for (const b of targets) {
        if (a === b) continue;
        const key = pairKey(a, b);
        if (explicitPairs.has(key)) continue;
        const bidirectional = rel.direction === 'bidirectional';
        if (hasPath(model, adjacency, a, b) || (bidirectional && hasPath(model, adjacency, b, a))) continue;
        const entry = out.get(key);
        if (!entry) out.set(key, { from: a, to: b, relations: [rel], implied: false, bidirectional, projected: true });
        else {
          entry.relations.push(rel);
          if (entry.from !== a || bidirectional) entry.bidirectional = true;
        }
      }
    }
  }
  return [...out.values()];
}

/** Ruta de nodos de un elemento de despliegue ("Datacenter central › OCP › BANCA"). */
export function deploymentPath(model: Model, id: Id): string {
  return ancestorsOf(model, id)
    .filter((a) => a.kind === 'node')
    .reverse()
    .map((a) => a.name)
    .join(' › ');
}

/** Relaciones de red que tocan algún elemento de despliegue. */
export function isNetworkRelation(model: Model, rel: Relation): boolean {
  const ends = [model.elements[rel.from], model.elements[rel.to]];
  return ends.some((e) => !!e && isDeploymentKind(e.kind));
}
