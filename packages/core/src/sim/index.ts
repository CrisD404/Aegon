import { ancestorsOf, descendantsOf, sortedValues, type Model } from '../model/index.ts';
import type { BusType, ContainerType, Element, Id, StoreType } from '../schema/index.ts';
import { inEnvironment, isDeploymentKind, isNetworkRelation } from '../deployment/index.ts';

/**
 * Simulador de carga: cuánto tráfico le llega a cada parte y cuál se queda sin margen primero.
 *
 * Es un modelo, no una medición: reparte el tráfico que entra por las relaciones del modelo y lo
 * compara con lo que cada parte aguanta (capacidad por réplica × réplicas del ambiente). Lo que no
 * está cargado se supone por tipo y queda marcado como supuesto. Sirve para ver órdenes de magnitud
 * y encontrar el cuello de botella; no reemplaza una prueba de carga.
 *
 * Se simula a nivel de contenedor, base, bus y sistema: los componentes cuentan para su
 * contenedor (son llamadas en proceso). Una llamada a algo saturado frena a quien la hace; lo que
 * pasa por un bus no frena a nadie, se acumula.
 */

export interface LoadScenario {
  /** Pedidos por segundo que entran, en total. */
  rps: number;
  /** Ambiente del que salen las réplicas. Sin ambiente, una réplica de cada cosa. */
  environment?: Id;
  /** Sistema a simular: entra solo el tráfico de actores hacia él. Sin sistema, todo el modelo. */
  scope?: Id;
}

export type LoadState = 'idle' | 'ok' | 'busy' | 'saturated';

export interface LoadNode {
  id: Id;
  /** Pedidos por segundo que le llegan. */
  load: number;
  /** Los que llega a atender (nunca más que su capacidad). */
  served: number;
  /** Lo que aguanta en total (por réplica × réplicas). `null`: sin límite conocido. */
  capacity: number | null;
  perReplica: number | null;
  replicas: number;
  /** La capacidad por réplica es un supuesto por tipo, no un dato cargado en el elemento. */
  assumed: boolean;
  /** Carga sobre capacidad (1 = al límite). `null` si no tiene límite conocido. */
  utilization: number | null;
  state: LoadState;
  /** Llama en línea a algo saturado: sus pedidos fallan o se demoran aunque él tenga margen. */
  affectedBy: Id[];
  /** Lo que le llega por un bus y no alcanza a procesar: se acumula, en pedidos por segundo. */
  backlog: number;
}

export interface LoadEdge {
  relation: Id;
  from: Id;
  to: Id;
  rps: number;
  /** Pasa por un bus: no es una llamada en línea. */
  async: boolean;
}

export interface LoadResult {
  nodes: Record<Id, LoadNode>;
  edges: LoadEdge[];
  /** Por dónde entra el tráfico y cuánto. */
  entries: { id: Id; rps: number }[];
  /**
   * Tráfico total que aguanta antes de que algo sature, y qué satura primero. Con `backlog`, lo
   * primero en saturar recibe todo por un bus: no falla nada, pero se atrasa cada vez más.
   */
  limit: { rps: number; bottleneck: Id; backlog: boolean } | null;
  /** Tráfico a partir del cual algo falla en línea (lo primero que satura sin un bus de por medio). */
  failureLimit: { rps: number; bottleneck: Id } | null;
  /** Lo saturado con este tráfico, del más exigido al menos. */
  saturated: Id[];
  /** Lo que el modelo no dice y el simulador supuso. */
  notes: string[];
}

/** Uso a partir del cual algo se considera exigido (sin margen para un pico). */
export const BUSY_FROM = 0.7;

// Capacidad típica por réplica, en pedidos por segundo, cuando el elemento no la declara. Son
// órdenes de magnitud para arrancar: el resultado marca cuáles se usaron.
const CONTAINER_CAPACITY: Readonly<Record<ContainerType, number | null>> = {
  web: 2000,
  api: 800,
  service: 300,
  worker: 100,
  function: 100,
  other: 300,
  // Corren en el dispositivo de cada usuario: no tienen un límite del lado del servidor.
  mobile: null,
  desktop: null,
};
const STORE_CAPACITY: Readonly<Record<StoreType, number>> = {
  relational: 1000,
  document: 2000,
  'key-value': 10000,
  cache: 20000,
  search: 500,
  object: 3000,
  graph: 500,
  'time-series': 5000,
  warehouse: 50,
  other: 1000,
};
const BUS_CAPACITY: Readonly<Record<BusType, number>> = { queue: 3000, topic: 5000, stream: 20000, 'event-bus': 2000 };

/** Capacidad por réplica que se supone para un elemento sin el dato (`null`: sin límite conocido). */
export function assumedCapacity(el: Element): number | null {
  if (el.kind === 'container') return CONTAINER_CAPACITY[el.containerType ?? 'other'];
  if (el.kind === 'store') return STORE_CAPACITY[el.store.type ?? 'other'];
  if (el.kind === 'bus') return BUS_CAPACITY[el.bus.type ?? 'topic'];
  // Un sistema externo es de otro: su límite no se conoce salvo que se cargue.
  if (el.kind === 'system') return el.scope === 'external' ? null : CONTAINER_CAPACITY.service;
  return null;
}

/** Capacidad por réplica declarada en el elemento, si la tiene. */
function declaredCapacity(el: Element): number | undefined {
  return 'load' in el ? el.load?.capacity : undefined;
}

/**
 * Réplicas de un elemento en un ambiente: las de sus instancias desplegadas; si no hay despliegue,
 * las cargadas en sus costos; si tampoco, una.
 */
export function replicasIn(model: Model, id: Id, env: Id | undefined): number {
  const el = model.elements[id];
  if (!el || !env) return 1;
  let total = 0;
  for (const other of Object.values(model.elements)) {
    if (other.kind === 'instance' && other.instance.of === id && inEnvironment(other, env)) total += other.instance.replicas ?? 1;
  }
  if (total) return total;
  return el.finops?.costs?.[env]?.replicas ?? 1;
}

/** Lo que se simula por un elemento: él mismo, o su contenedor si es un componente. */
function unitOf(model: Model, id: Id): Id | null {
  const el = model.elements[id];
  if (!el || el.kind === 'actor' || el.kind === 'group' || isDeploymentKind(el.kind)) return null;
  if (el.kind === 'component') return ancestorsOf(model, id).find((a) => a.kind === 'container')?.id ?? id;
  return id;
}

/** Una relación hacia un bus es de consumo (el bus le entrega) si su etiqueta lo dice. */
const CONSUMES = /consum|suscri|subscri|escuch|listen|\blee\b|\bleen\b|\breads?\b|recibe/i;

interface Edge {
  from: Id;
  to: Id;
  weight: number;
  async: boolean;
  relation: Id;
}

export function simulateLoad(model: Model, scenario: LoadScenario): LoadResult {
  const notes: string[] = [];
  const inScope = scenario.scope ? new Set<Id>([scenario.scope, ...descendantsOf(model, scenario.scope)]) : null;

  // 1. El grafo: una arista por relación entre unidades distintas, y las entradas desde actores.
  const edges: Edge[] = [];
  const entryWeights = new Map<Id, number>();
  for (const rel of sortedValues(model.relations)) {
    if (isNetworkRelation(model, rel)) continue;
    const from = model.elements[rel.from];
    const to = model.elements[rel.to];
    if (!from || !to) continue;
    const weight = rel.calls ?? 1;
    if (!weight) continue;
    if (from.kind === 'actor') {
      const unit = unitOf(model, rel.to);
      if (unit && (!inScope || inScope.has(unit))) entryWeights.set(unit, (entryWeights.get(unit) ?? 0) + weight);
      continue;
    }
    const a = unitOf(model, rel.from);
    const b = unitOf(model, rel.to);
    if (!a || !b || a === b) continue;
    const toBus = model.elements[b]!.kind === 'bus';
    const fromBus = model.elements[a]!.kind === 'bus';
    if (toBus && !fromBus && CONSUMES.test(rel.label ?? '')) {
      // "X consume de un bus": el tráfico va del bus a X.
      edges.push({ from: b, to: a, weight, async: true, relation: rel.id });
      notes.push(`"${model.elements[a]!.name}" consume de "${model.elements[b]!.name}" (por la etiqueta de la relación)`);
    } else {
      edges.push({ from: a, to: b, weight, async: fromBus, relation: rel.id });
    }
  }

  // Sin actores, el tráfico entra por lo que nadie llama.
  if (!entryWeights.size) {
    const called = new Set(edges.map((e) => e.to));
    for (const e of edges) {
      if (!called.has(e.from) && (!inScope || inScope.has(e.from))) entryWeights.set(e.from, 1);
    }
    if (entryWeights.size) notes.push('Ningún actor llega a lo simulado: el tráfico entra por lo que nadie llama');
  }
  const totalWeight = [...entryWeights.values()].reduce((a, b) => a + b, 0);
  if (entryWeights.size > 1) notes.push(`El tráfico se reparte entre ${entryWeights.size} entradas según las llamadas por pedido de cada relación (por defecto, en partes iguales)`);

  // 2. Orden de recorrido desde las entradas, cortando los ciclos.
  const out = new Map<Id, Edge[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e]);
  const order: Id[] = [];
  const state = new Map<Id, 'open' | 'done'>();
  const live = new Set<Edge>();
  const visit = (id: Id) => {
    state.set(id, 'open');
    for (const e of out.get(id) ?? []) {
      const seen = state.get(e.to);
      if (seen === 'open') continue; // cierra un ciclo: no se vuelve a contar
      live.add(e);
      if (!seen) visit(e.to);
    }
    state.set(id, 'done');
    order.push(id);
  };
  for (const id of [...entryWeights.keys()].sort()) if (!state.has(id)) visit(id);
  order.reverse();

  // 3. Capacidades.
  const capacity = new Map<Id, { total: number | null; perReplica: number | null; replicas: number; assumed: boolean }>();
  for (const id of order) {
    const el = model.elements[id]!;
    const declared = declaredCapacity(el);
    const perReplica = declared ?? assumedCapacity(el);
    const replicas = replicasIn(model, id, scenario.environment);
    capacity.set(id, { total: perReplica === null ? null : perReplica * replicas, perReplica, replicas, assumed: declared === undefined && perReplica !== null });
  }

  // 4. Reparto: cada unidad atiende hasta su capacidad y lo que atiende sigue por sus relaciones.
  const run = (rps: number, limited: boolean) => {
    const load = new Map<Id, number>();
    const served = new Map<Id, number>();
    const flow = new Map<Edge, number>();
    for (const [id, w] of entryWeights) load.set(id, totalWeight ? (rps * w) / totalWeight : 0);
    for (const id of order) {
      const l = load.get(id) ?? 0;
      const cap = limited ? capacity.get(id)!.total : null;
      const s = cap === null ? l : Math.min(l, cap);
      served.set(id, s);
      for (const e of out.get(id) ?? []) {
        if (!live.has(e)) continue;
        const through = s * e.weight;
        flow.set(e, through);
        load.set(e.to, (load.get(e.to) ?? 0) + through);
      }
    }
    return { load, served, flow };
  };

  // Lo que recibe todo su tráfico por un bus: si satura, se atrasa (no hace fallar a nadie).
  const fedByBus = new Set<Id>();
  for (const id of order) {
    const incoming = [...live].filter((e) => e.to === id);
    if (incoming.length && incoming.every((e) => e.async) && !entryWeights.has(id)) fedByBus.add(id);
  }

  // Hasta el primer cuello todo crece en proporción al tráfico: alcanza con una pasada unitaria.
  const unit = run(1, false);
  let limit: LoadResult['limit'] = null;
  let failureLimit: LoadResult['failureLimit'] = null;
  const earlier = (at: number, id: Id, best: { rps: number; bottleneck: Id } | null) =>
    !best || at < best.rps - 1e-9 || (Math.abs(at - best.rps) < 1e-9 && id < best.bottleneck);
  for (const id of order) {
    const cap = capacity.get(id)!.total;
    const k = unit.load.get(id) ?? 0;
    if (cap === null || k <= 0) continue;
    const at = cap / k;
    if (earlier(at, id, limit)) limit = { rps: at, bottleneck: id, backlog: fedByBus.has(id) };
    if (!fedByBus.has(id) && earlier(at, id, failureLimit)) failureLimit = { rps: at, bottleneck: id };
  }

  const real = run(Math.max(0, scenario.rps), true);
  const nodes: Record<Id, LoadNode> = {};
  for (const id of order) {
    const cap = capacity.get(id)!;
    const load = real.load.get(id) ?? 0;
    const utilization = cap.total === null ? null : cap.total > 0 ? load / cap.total : Infinity;
    const nodeState: LoadState = load <= 0 ? 'idle' : utilization === null ? 'ok' : utilization > 1 + 1e-9 ? 'saturated' : utilization >= BUSY_FROM ? 'busy' : 'ok';
    nodes[id] = {
      id,
      load,
      served: real.served.get(id) ?? 0,
      capacity: cap.total,
      perReplica: cap.perReplica,
      replicas: cap.replicas,
      assumed: cap.assumed,
      utilization,
      state: nodeState,
      affectedBy: [],
      backlog: 0,
    };
  }

  // 5. Efecto en cadena: quien llama en línea a algo saturado queda afectado; por un bus, se acumula.
  const saturated = order.filter((id) => nodes[id]!.state === 'saturated').sort((a, b) => (nodes[b]!.utilization ?? 0) - (nodes[a]!.utilization ?? 0) || a.localeCompare(b));
  const callers = new Map<Id, Id[]>();
  for (const e of live) if (!e.async) callers.set(e.to, [...(callers.get(e.to) ?? []), e.from]);
  for (const hot of saturated) {
    const seen = new Set<Id>([hot]);
    const queue = [hot];
    while (queue.length) {
      for (const caller of callers.get(queue.shift()!) ?? []) {
        if (seen.has(caller)) continue;
        seen.add(caller);
        nodes[caller]!.affectedBy.push(hot);
        queue.push(caller);
      }
    }
    const node = nodes[hot]!;
    const viaBus = [...live].filter((e) => e.to === hot && e.async).reduce((sum, e) => sum + (real.flow.get(e) ?? 0), 0);
    if (viaBus > 0) node.backlog = Math.min(viaBus, node.load - node.served);
  }

  if (order.some((id) => nodes[id]!.assumed)) notes.push('Las capacidades sin cargar se supusieron por tipo: ajustalas donde tengas el dato');
  return {
    nodes,
    edges: [...live].map((e) => ({ relation: e.relation, from: e.from, to: e.to, rps: real.flow.get(e) ?? 0, async: e.async })).sort((a, b) => a.relation.localeCompare(b.relation)),
    entries: [...entryWeights].map(([id, w]) => ({ id, rps: totalWeight ? (Math.max(0, scenario.rps) * w) / totalWeight : 0 })).sort((a, b) => a.id.localeCompare(b.id)),
    limit,
    failureLimit,
    saturated,
    notes,
  };
}
