import { z } from 'zod';

/**
 * Esquemas del formato Aegon v2.
 *
 * Reglas generales:
 * - Los IDs son legibles (`payments-api`) e inmutables: renombrar un elemento no cambia su ID.
 * - Los campos opcionales con valor por defecto se omiten al serializar para mantener el YAML limpio.
 * - `extensions` guarda datos que Aegon todavía no modela (por ejemplo FinOps importado de C4Pro).
 */

export const SCHEMA_VERSION = 2;

/** Acepta slugs y también los IDs nanoid heredados de C4Pro (pueden empezar con `-` o `_`). */
export const Id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/, 'ID inválido: usá letras, números, ".", "_" o "-"');
export type Id = z.infer<typeof Id>;

export const ELEMENT_KINDS = ['actor', 'system', 'container', 'component', 'store', 'bus', 'group'] as const;
export const ElementKind = z.enum(ELEMENT_KINDS);
export type ElementKind = z.infer<typeof ElementKind>;

export const STATUSES = ['planned', 'live', 'deprecated', 'retired'] as const;
export const Status = z.enum(STATUSES);
export type Status = z.infer<typeof Status>;

export const RISKS = ['low', 'medium', 'high', 'critical'] as const;
export const Risk = z.enum(RISKS);
export type Risk = z.infer<typeof Risk>;

export const Scope = z.enum(['internal', 'external']);
export type Scope = z.infer<typeof Scope>;

export const Link = z.object({
  url: z.string().min(1),
  label: z.string().optional(),
});
export type Link = z.infer<typeof Link>;

const Extensions = z.record(z.string(), z.unknown());
const Properties = z.record(z.string(), z.string());

const baseElement = {
  id: Id,
  name: z.string().min(1),
  /** Descripción corta, visible en el nodo. */
  description: z.string().optional(),
  /** Documentación larga en Markdown. */
  docs: z.string().optional(),
  /** Padre en la jerarquía C4 (container → system, component → container, group → group). */
  parent: Id.optional(),
  /** Grupos (cloud, red, plataforma, on-prem) a los que pertenece el elemento. */
  groups: z.array(Id).optional(),
  /** Por defecto `internal`. */
  scope: Scope.optional(),
  /** Por defecto `live`. */
  status: Status.optional(),
  tags: z.array(z.string()).optional(),
  links: z.array(Link).optional(),
  owner: z.string().optional(),
  properties: Properties.optional(),
  extensions: Extensions.optional(),
};

export const Actor = z.object({
  ...baseElement,
  kind: z.literal('actor'),
  /** Rol o persona (ej. "Cliente minorista", "Operador de soporte"). */
  role: z.string().optional(),
});
export type Actor = z.infer<typeof Actor>;

const softwareFields = {
  technology: z.array(z.string()).optional(),
  risk: Risk.optional(),
};

export const System = z.object({
  ...baseElement,
  ...softwareFields,
  kind: z.literal('system'),
});
export type System = z.infer<typeof System>;

export const CONTAINER_TYPES = [
  'web',
  'mobile',
  'desktop',
  'api',
  'service',
  'worker',
  'function',
  'other',
] as const;
export const ContainerType = z.enum(CONTAINER_TYPES);
export type ContainerType = z.infer<typeof ContainerType>;

export const Container = z.object({
  ...baseElement,
  ...softwareFields,
  kind: z.literal('container'),
  containerType: ContainerType.optional(),
});
export type Container = z.infer<typeof Container>;

export const Component = z.object({
  ...baseElement,
  ...softwareFields,
  kind: z.literal('component'),
});
export type Component = z.infer<typeof Component>;

export const STORE_TYPES = [
  'relational',
  'document',
  'key-value',
  'cache',
  'search',
  'object',
  'graph',
  'time-series',
  'warehouse',
  'other',
] as const;
export const StoreType = z.enum(STORE_TYPES);
export type StoreType = z.infer<typeof StoreType>;

export const StoreDetails = z.object({
  /** ID del catálogo (`postgresql`, `mongodb`…) u `other`. */
  engine: z.string().min(1),
  /** Nombre del motor cuando `engine: other`. */
  customEngine: z.string().optional(),
  /** Ícono elegido para un motor personalizado (clave del registro de íconos). */
  customIcon: z.string().optional(),
  type: StoreType.optional(),
  version: z.string().optional(),
  /** Servicio administrado (ej. `aws-rds`, `cloud-sql`). */
  managed: z.string().optional(),
});
export type StoreDetails = z.infer<typeof StoreDetails>;

/** La tecnología de una base de datos es su motor (`store.engine`), no un lenguaje. */
export const Store = z.object({
  ...baseElement,
  kind: z.literal('store'),
  risk: Risk.optional(),
  store: StoreDetails,
});
export type Store = z.infer<typeof Store>;

export const BUS_TYPES = ['queue', 'topic', 'stream', 'event-bus'] as const;
export const BusType = z.enum(BUS_TYPES);
export type BusType = z.infer<typeof BusType>;

export const BusDetails = z.object({
  /** ID del catálogo de brokers (`kafka`, `rabbitmq`, `sqs`…) u `other`. */
  broker: z.string().min(1),
  /** Nombre del broker cuando `broker: other`. */
  customBroker: z.string().optional(),
  customIcon: z.string().optional(),
  type: BusType.optional(),
  /** Tópicos, colas o streams relevantes para el diagrama. */
  topics: z.array(z.string()).optional(),
});
export type BusDetails = z.infer<typeof BusDetails>;

/** Bus de mensajería (Kafka, RabbitMQ, SQS…): un contenedor especializado en C4. */
export const Bus = z.object({
  ...baseElement,
  kind: z.literal('bus'),
  risk: Risk.optional(),
  bus: BusDetails,
});
export type Bus = z.infer<typeof Bus>;

export const GROUP_PROVIDERS = [
  'aws',
  'gcp',
  'azure',
  'onprem',
  'network',
  'platform',
  'other',
] as const;
export const GroupProvider = z.enum(GROUP_PROVIDERS);
export type GroupProvider = z.infer<typeof GroupProvider>;

export const GroupDetails = z.object({
  provider: GroupProvider,
  region: z.string().optional(),
  account: z.string().optional(),
  cidr: z.string().optional(),
});
export type GroupDetails = z.infer<typeof GroupDetails>;

export const Group = z.object({
  ...baseElement,
  kind: z.literal('group'),
  group: GroupDetails,
});
export type Group = z.infer<typeof Group>;

export const Element = z.discriminatedUnion('kind', [
  Actor,
  System,
  Container,
  Component,
  Store,
  Bus,
  Group,
]);
export type Element = z.infer<typeof Element>;
export type ElementOf<K extends ElementKind> = Extract<Element, { kind: K }>;

export const Direction = z.enum(['outgoing', 'bidirectional']);
export type Direction = z.infer<typeof Direction>;

export const Relation = z.object({
  id: Id,
  from: Id,
  to: Id,
  label: z.string().optional(),
  description: z.string().optional(),
  /** Protocolos de la comunicación (catálogo `PROTOCOLS`: `https`, `grpc`, `jdbc`, `kafka`…). */
  protocols: z.array(z.string()).optional(),
  /** Por defecto `outgoing`. */
  direction: Direction.optional(),
  status: Status.optional(),
  tags: z.array(z.string()).optional(),
  properties: Properties.optional(),
  extensions: Extensions.optional(),
});
export type Relation = z.infer<typeof Relation>;

export const LEVELS = [1, 2, 3] as const;
export const Level = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Level = z.infer<typeof Level>;

export const NodeLayout = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive().optional(),
  h: z.number().positive().optional(),
});
export type NodeLayout = z.infer<typeof NodeLayout>;

export const EdgeShape = z.enum(['curved', 'straight', 'step']);
export type EdgeShape = z.infer<typeof EdgeShape>;

export const EdgeStyle = z.object({
  shape: EdgeShape.optional(),
  hidden: z.boolean().optional(),
});
export type EdgeStyle = z.infer<typeof EdgeStyle>;

export const View = z.object({
  id: Id,
  name: z.string().min(1),
  level: Level,
  /** Elemento que se "abre": system en L2, container en L3. Vacío en L1. */
  scope: Id.optional(),
  description: z.string().optional(),
  /** Posición (absoluta) de cada elemento ubicado en el lienzo, indexada por ID de elemento. */
  nodes: z.record(Id, NodeLayout),
  /** Estilo por relación (solo para las que se apartan del default). */
  edges: z.record(Id, EdgeStyle).optional(),
  extensions: Extensions.optional(),
});
export type View = z.infer<typeof View>;

export const WorkspaceMeta = z.object({
  schema: z.literal(SCHEMA_VERSION),
  id: Id,
  name: z.string().min(1),
  description: z.string().optional(),
  organization: z.string().optional(),
  architect: z.string().optional(),
  /** Lienzo que se abre por defecto. */
  defaultView: Id.optional(),
  extensions: Extensions.optional(),
});
export type WorkspaceMeta = z.infer<typeof WorkspaceMeta>;

/** Esquemas exportados como JSON Schema (para agentes de IA y editores YAML). */
export const jsonSchemas = {
  workspace: WorkspaceMeta,
  element: Element,
  relation: Relation,
  view: View,
} as const;
