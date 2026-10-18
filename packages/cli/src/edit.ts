import {
  CONTAINER_TYPES,
  DB_ENGINES,
  ELEMENT_KINDS,
  GROUP_PROVIDERS,
  MESSAGE_BROKERS,
  PROTOCOLS,
  TECHNOLOGIES,
  KINDS_WITH_TECHNOLOGY,
  applyOp,
  arrangeViewOp,
  batch,
  connectOp,
  createElementOp,
  findBroker,
  findEngine,
  findProtocol,
  findTechnology,
  freePositions,
  placementProblem,
  sortedValues,
  suggestProtocols,
  type CatalogItem,
  type ContainerType,
  type Direction,
  type Element,
  type ElementKind,
  type GroupProvider,
  type Id,
  type Model,
  type NodeLayout,
  type Op,
  type Relation,
  type RelationPatch,
  type Risk,
  type Status,
} from '@aegon/core';
import { WorkspaceError, resolveRef } from './workspace.ts';

/**
 * Comandos de edición de alto nivel que comparten la CLI y el servidor MCP: aceptan IDs o
 * nombres, completan los catálogos (motor, broker, protocolos) y devuelven la `Op` a aplicar.
 */

const KIND_ALIASES: Readonly<Record<string, ElementKind>> = {
  actor: 'actor',
  person: 'actor',
  persona: 'actor',
  usuario: 'actor',
  system: 'system',
  sistema: 'system',
  container: 'container',
  contenedor: 'container',
  app: 'container',
  component: 'component',
  componente: 'component',
  store: 'store',
  db: 'store',
  database: 'store',
  base: 'store',
  'base-de-datos': 'store',
  bus: 'bus',
  queue: 'bus',
  cola: 'bus',
  topic: 'bus',
  group: 'group',
  grupo: 'group',
};

export function resolveKind(kind: string): ElementKind {
  const k = KIND_ALIASES[kind.trim().toLowerCase()];
  if (!k) throw new WorkspaceError('invalid-kind', `Tipo de elemento desconocido "${kind}": usá ${ELEMENT_KINDS.join(', ')}`);
  return k;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** ID del catálogo por ID, nombre o palabra clave (`postgres` → `postgresql`). */
function catalogId<T extends CatalogItem>(items: readonly T[], value: string, find: (id: string) => T | undefined): string | undefined {
  const direct = find(value) ?? find(value.toLowerCase());
  if (direct) return direct.id;
  const q = norm(value);
  return items.find((i) => norm(i.name) === q || i.keywords?.includes(q))?.id;
}

export interface AddElementInput {
  kind: string;
  name: string;
  id?: string;
  parent?: string;
  /** Lienzo donde ubicarlo; sin `at`, se busca un lugar libre. */
  view?: string;
  at?: { x: number; y: number };
  description?: string;
  docs?: string;
  technology?: string[];
  containerType?: string;
  role?: string;
  engine?: string;
  broker?: string;
  topics?: string[];
  provider?: string;
  region?: string;
  external?: boolean;
  status?: Status;
  risk?: Risk;
  tags?: string[];
  owner?: string;
  groups?: string[];
}

export interface AddElementPlan {
  op: Op;
  id: Id;
  element: Element;
  view?: Id;
  position?: NodeLayout;
  warnings: string[];
}

export function planAddElement(model: Model, input: AddElementInput): AddElementPlan {
  const kind = resolveKind(input.kind);
  const name = input.name.trim();
  if (!name) throw new WorkspaceError('invalid-name', 'El nombre no puede estar vacío');
  const warnings: string[] = [];
  const elements = sortedValues(model.elements);
  const fields: Record<string, unknown> = {};
  if (input.id) fields.id = input.id;
  if (input.description) fields.description = input.description;
  if (input.docs) fields.docs = input.docs;
  if (input.owner) fields.owner = input.owner;
  if (input.tags?.length) fields.tags = input.tags;
  if (input.status) fields.status = input.status;
  if (input.external) fields.scope = 'external';
  if (input.parent) fields.parent = resolveRef(elements, input.parent, 'elemento').id;
  if (input.groups?.length) fields.groups = input.groups.map((g) => resolveRef(elements, g, 'grupo').id);

  if (input.risk) {
    if (kind === 'actor' || kind === 'group') warnings.push(`"risk" no aplica a un ${kind}: se ignora`);
    else fields.risk = input.risk;
  }
  if (input.technology?.length) {
    if (!KINDS_WITH_TECHNOLOGY.includes(kind)) {
      warnings.push(`"technology" solo aplica a system, container y component (una base se describe por su motor y un bus por su broker)`);
    } else {
      fields.technology = normalizeTechnologies(input.technology, warnings);
    }
  }
  if (input.containerType) {
    if (kind !== 'container') warnings.push('"containerType" solo aplica a un container: se ignora');
    else if (!(CONTAINER_TYPES as readonly string[]).includes(input.containerType)) {
      throw new WorkspaceError('invalid-field', `containerType inválido "${input.containerType}": usá ${CONTAINER_TYPES.join(', ')}`);
    } else fields.containerType = input.containerType as ContainerType;
  }
  if (input.role) {
    if (kind !== 'actor') warnings.push('"role" solo aplica a un actor: se ignora');
    else fields.role = input.role;
  }
  if (kind === 'store') {
    const engineId = input.engine ? catalogId(DB_ENGINES, input.engine, findEngine) : undefined;
    if (input.engine && !engineId) warnings.push(`Motor "${input.engine}" fuera del catálogo: se guarda como engine: other`);
    fields.store = engineId
      ? { engine: engineId, type: findEngine(engineId)!.type }
      : input.engine
        ? { engine: 'other', customEngine: input.engine }
        : { engine: 'other' };
  } else if (input.engine) warnings.push('"engine" solo aplica a una base de datos (store): se ignora');
  if (kind === 'bus') {
    const brokerId = input.broker ? catalogId(MESSAGE_BROKERS, input.broker, findBroker) : undefined;
    if (input.broker && !brokerId) warnings.push(`Broker "${input.broker}" fuera del catálogo: se guarda como broker: other`);
    const bus: Record<string, unknown> = brokerId
      ? { broker: brokerId, type: findBroker(brokerId)!.type }
      : input.broker
        ? { broker: 'other', customBroker: input.broker }
        : { broker: 'other' };
    if (input.topics?.length) bus.topics = input.topics;
    fields.bus = bus;
  } else if (input.broker) warnings.push('"broker" solo aplica a un bus de mensajería: se ignora');
  if (kind === 'group') {
    const provider = (input.provider ?? 'other').toLowerCase();
    if (!(GROUP_PROVIDERS as readonly string[]).includes(provider)) {
      throw new WorkspaceError('invalid-field', `Proveedor inválido "${input.provider}": usá ${GROUP_PROVIDERS.join(', ')}`);
    }
    fields.group = input.region ? { provider: provider as GroupProvider, region: input.region } : { provider: provider as GroupProvider };
  } else if (input.provider) warnings.push('"provider" solo aplica a un grupo: se ignora');

  const view = input.view ? resolveRef(sortedValues(model.views), input.view, 'lienzo') : undefined;
  const created = createElementOp(model, { kind, name, fields: fields as Partial<Element>, view: view?.id });
  if (!view) {
    const element = (created.op as Extract<Op, { type: 'element.add' }>).element;
    return { op: created.op, id: created.id, element, warnings };
  }
  // Se aplica a un borrador para validar el elemento y su ubicación antes de tocar el disco.
  const draft = applyOp(model, created.op).model;
  const element = draft.elements[created.id]!;
  const problem = placementProblem(draft, view, element);
  if (problem) throw new WorkspaceError('invalid-placement', `${problem} ("${element.name}" en "${view.name}")`);
  const position = input.at ? { x: input.at.x, y: input.at.y } : freePositions(draft, view.id, [created.id])[created.id]!;
  const op = batch([created.op, { type: 'view.place', view: view.id, nodes: { [created.id]: position } }], `Agregar ${element.name}`);
  return { op, id: created.id, element, view: view.id, position, warnings };
}

export interface ConnectInput {
  from: string;
  to: string;
  label?: string;
  description?: string;
  protocols?: string[];
  direction?: Direction;
  status?: Status;
  tags?: string[];
}

export interface ConnectPlan {
  /** `null` si ya estaban conectados y no hay nada que cambiar. */
  op: Op | null;
  /** created: nueva · bidirectional: existía al revés · updated: existía y se completó · exists: sin cambios. */
  result: 'created' | 'bidirectional' | 'updated' | 'exists';
  id: Id;
  from: Id;
  to: Id;
  warnings: string[];
  /** Protocolos sugeridos para el destino cuando no se indicó ninguno. */
  suggestions: string[];
}

/** IDs del catálogo de tecnologías (`Spring Boot` → `spring-boot`); lo desconocido queda tal cual. */
export function normalizeTechnologies(technologies: readonly string[], warnings: string[]): string[] {
  return technologies.map((t) => {
    const id = catalogId(TECHNOLOGIES, t, findTechnology);
    if (!id) warnings.push(`Tecnología "${t}" fuera del catálogo: se guarda tal cual`);
    return id ?? t;
  });
}

/** IDs del catálogo de protocolos (`HTTPS` → `https`, `gRPC` → `grpc`). */
export function normalizeProtocols(protocols: readonly string[], warnings: string[]): string[] {
  return protocols.map((p) => {
    const id = catalogId(PROTOCOLS, p, findProtocol);
    if (!id) warnings.push(`Protocolo "${p}" fuera del catálogo: se guarda tal cual`);
    return id ?? p;
  });
}

export function planConnect(model: Model, input: ConnectInput): ConnectPlan {
  const elements = sortedValues(model.elements);
  const from = resolveRef(elements, input.from, 'elemento').id;
  const to = resolveRef(elements, input.to, 'elemento').id;
  const warnings: string[] = [];
  const fields: Partial<Omit<Relation, 'id' | 'from' | 'to'>> = {};
  if (input.label) fields.label = input.label;
  if (input.description) fields.description = input.description;
  if (input.protocols?.length) fields.protocols = normalizeProtocols(input.protocols, warnings);
  if (input.direction && input.direction !== 'outgoing') fields.direction = input.direction;
  if (input.status) fields.status = input.status;
  if (input.tags?.length) fields.tags = input.tags;
  const suggestions = fields.protocols ? [] : suggestProtocols(model.elements[to], '', 3).map((p) => p.id);

  const connected = connectOp(model, from, to, fields);
  const base = { id: connected.id, from, to, warnings, suggestions };
  if (connected.kind === 'created') return { ...base, op: connected.op, result: 'created' };
  if (connected.kind === 'bidirectional') {
    const patch: RelationPatch = { ...fields, direction: 'bidirectional' };
    return { ...base, op: { type: 'relation.update', id: connected.id, patch }, result: 'bidirectional' };
  }
  if (!Object.keys(fields).length) return { ...base, op: null, result: 'exists' };
  return { ...base, op: { type: 'relation.update', id: connected.id, patch: fields }, result: 'updated' };
}

export interface PlacePlan {
  op: Op | null;
  view: Id;
  nodes: Record<Id, NodeLayout>;
  /** Elementos que ya estaban ubicados (sin posición nueva): no se mueven. */
  skipped: Id[];
}

/**
 * Ubica elementos en un lienzo. Con posición explícita los mueve; sin posición, los que ya
 * estaban quedan donde están y los nuevos van a un lugar libre.
 */
export function planPlace(model: Model, viewRef: string, ids: readonly string[], positions: Record<string, NodeLayout> = {}): PlacePlan {
  const view = resolveRef(sortedValues(model.views), viewRef, 'lienzo');
  const elements = sortedValues(model.elements);
  const nodes: Record<Id, NodeLayout> = {};
  const skipped: Id[] = [];
  const pending: Id[] = [];
  const refs = [...new Set([...ids, ...Object.keys(positions)])];
  for (const ref of refs) {
    const el = resolveRef(elements, ref, 'elemento');
    const problem = placementProblem(model, view, el);
    if (problem) throw new WorkspaceError('invalid-placement', `${problem} ("${el.name}" en "${view.name}")`);
    const at = positions[ref] ?? positions[el.id];
    if (at) nodes[el.id] = at;
    else if (view.nodes[el.id]) skipped.push(el.id);
    else pending.push(el.id);
  }
  Object.assign(nodes, freePositions(model, view.id, pending));
  return { op: Object.keys(nodes).length ? { type: 'view.place', view: view.id, nodes } : null, view: view.id, nodes, skipped };
}

export function planLayout(model: Model, viewRef: string, ids?: readonly string[]): { op: Op | null; view: Id; moved: number } {
  const view = resolveRef(sortedValues(model.views), viewRef, 'lienzo');
  const elements = sortedValues(model.elements);
  const targets = ids?.map((r) => resolveRef(elements, r, 'elemento').id);
  const op = arrangeViewOp(model, view.id, targets);
  if (!op || op.type !== 'view.place') return { op: null, view: view.id, moved: 0 };
  const moved = Object.entries(op.nodes).filter(([id, l]) => {
    const prev = view.nodes[id];
    return !prev || prev.x !== l.x || prev.y !== l.y || prev.w !== l.w || prev.h !== l.h;
  }).length;
  return { op: moved ? op : null, view: view.id, moved };
}
