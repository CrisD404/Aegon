import type { Id, Relation, Status } from '../schema/index.ts';
import type { Model } from './index.ts';

/**
 * Estado de un elemento o una relación tal como se ve en un diagrama: qué es nuevo, qué ya existe,
 * qué se modifica y qué se da de baja. Lo que no se marca lo toma de su contexto: lo que está
 * dentro de un servidor nuevo también es nuevo, y una relación con algo que deja de existir se va
 * con él.
 */
export interface StatusInfo {
  status: Status;
  /** `own`: marcado en el elemento. `ancestor`: lo contiene algo que lo lleva. `target`: lo despliega. `end`: un extremo de la relación. */
  from: 'own' | 'ancestor' | 'target' | 'end' | 'default';
  /** De quién lo toma, cuando no es propio. */
  source?: Id;
}

/** Estados que alcanzan a todo lo que el elemento contiene y a lo que se conecta con él. */
const CARRIED: ReadonlySet<Status> = new Set<Status>(['planned', 'deprecated', 'retired']);
const LIVE: StatusInfo = { status: 'live', from: 'default' };

function own(status: Status | undefined): Status | undefined {
  return status && status !== 'live' ? status : undefined;
}

/** Estado efectivo de un elemento: el propio, el de quien lo contiene o el de lo que despliega. */
export function statusOf(model: Model, id: Id, seen: Set<Id> = new Set()): StatusInfo {
  const el = model.elements[id];
  if (!el || seen.has(id)) return LIVE;
  seen.add(id);
  const mine = own(el.status);
  if (mine) return { status: mine, from: 'own' };
  // Lo que todavía no existe (o deja de existir) arrastra a lo que tiene adentro.
  const chain = new Set<Id>([id]);
  let parent = el.parent;
  while (parent && !chain.has(parent)) {
    chain.add(parent);
    const p = model.elements[parent];
    if (!p) break;
    const carried = own(p.status);
    if (carried && CARRIED.has(carried)) return { status: carried, from: 'ancestor', source: p.id };
    parent = p.parent;
  }
  // Una instancia sin marca propia se ve como lo que despliega.
  if (el.kind === 'instance') {
    const target = statusOf(model, el.instance.of, seen);
    if (target.status !== 'live') return { status: target.status, from: 'target', source: el.instance.of };
  }
  return LIVE;
}

/** Estado que una relación toma de sus extremos: si uno todavía no existe o deja de existir, ella también. */
export function carriedStatus(model: Model, ends: readonly Id[]): StatusInfo | undefined {
  let found: StatusInfo | undefined;
  const rank = (s: Status) => (s === 'retired' ? 3 : s === 'planned' ? 2 : 1);
  for (const id of ends) {
    const { status } = statusOf(model, id);
    if (!CARRIED.has(status)) continue;
    if (!found || rank(status) > rank(found.status)) found = { status, from: 'end', source: id };
  }
  return found;
}

/**
 * Estado efectivo de una relación. `ends` permite evaluarla entre otros extremos (en un despliegue,
 * una relación lógica se dibuja entre las instancias).
 */
export function relationStatusOf(model: Model, rel: Relation, ends: readonly Id[] = [rel.from, rel.to]): StatusInfo {
  const mine = own(rel.status);
  if (mine) return { status: mine, from: 'own' };
  return carriedStatus(model, ends) ?? LIVE;
}

/** Estado de una línea que junta varias relaciones: el que comparten, o «se modifica» si difieren. */
export function mergedStatus(statuses: readonly Status[]): Status {
  const set = new Set(statuses);
  if (set.size === 0) return 'live';
  return set.size === 1 ? statuses[0]! : 'changing';
}

export interface StatusCount {
  status: Status;
  elements: Id[];
  relations: Id[];
}

/** Qué hay marcado en un conjunto de elementos y relaciones (sin `live`), en el orden en que se lee. */
export function statusCounts(model: Model, elementIds: readonly Id[], relationIds: readonly Id[]): StatusCount[] {
  const order: Status[] = ['planned', 'changing', 'deprecated', 'retired'];
  const byStatus = new Map<Status, StatusCount>();
  const at = (status: Status) => {
    let entry = byStatus.get(status);
    if (!entry) byStatus.set(status, (entry = { status, elements: [], relations: [] }));
    return entry;
  };
  for (const id of elementIds) {
    const { status } = statusOf(model, id);
    if (status !== 'live') at(status).elements.push(id);
  }
  for (const id of relationIds) {
    const rel = model.relations[id];
    if (!rel) continue;
    const { status } = relationStatusOf(model, rel);
    if (status !== 'live') at(status).relations.push(id);
  }
  return order.map((s) => byStatus.get(s)).filter((c): c is StatusCount => !!c);
}
