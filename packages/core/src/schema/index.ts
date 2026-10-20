import { z } from 'zod';

/**
 * Esquemas del formato Aegon v2.
 *
 * Reglas generales:
 * - Los IDs son legibles (`payments-api`) e inmutables: renombrar un elemento no cambia su ID.
 * - Los campos opcionales con valor por defecto se omiten al serializar para mantener el YAML limpio.
 * - `extensions` guarda datos que Aegon todavía no modela (por ejemplo, de otras herramientas).
 */

export const SCHEMA_VERSION = 2;

/** Acepta slugs y también IDs generados por otras herramientas (pueden empezar con `-` o `_`). */
export const Id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/, 'ID inválido: usá letras, números, ".", "_" o "-"');
export type Id = z.infer<typeof Id>;

export const ELEMENT_KINDS = ['actor', 'system', 'container', 'component', 'store', 'bus', 'group', 'node', 'infra', 'instance'] as const;
/** Tipos que solo existen en los lienzos de despliegue (dónde y cómo corre el software en cada ambiente). */
export const DEPLOYMENT_KINDS = ['node', 'infra', 'instance'] as const;
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

/** Costo mensual estimado de un elemento en un ambiente (en la moneda del workspace). */
export const CostEntry = z.object({
  monthly: z.number().nonnegative(),
  /** Réplicas, instancias o nodos. */
  replicas: z.number().int().positive().optional(),
  /** Tamaño o SKU (ej. `m6i.large`, `db.r6g.xlarge`, `Standard_D4s_v5`). */
  sku: z.string().optional(),
  note: z.string().optional(),
});
export type CostEntry = z.infer<typeof CostEntry>;

/** Datos FinOps de un elemento. */
export const FinOps = z.object({
  /** Costo por ambiente (clave: ID de un ambiente del workspace). */
  costs: z.record(Id, CostEntry).optional(),
  /** Etiquetas de asignación de costos (`cost-center`, `project`, `owner`…). */
  tags: z.record(z.string(), z.string()).optional(),
});
export type FinOps = z.infer<typeof FinOps>;

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
  /** Ambientes donde está desplegado (IDs del workspace). Sin el campo: en todos. */
  environments: z.array(Id).optional(),
  finops: FinOps.optional(),
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

// -----------------------------------------------------------------------------------------------
// Despliegue (C4 deployment): nodos, infraestructura e instancias. Cada uno vale para los
// ambientes de `environments` (sin el campo, para todos).

/** Direcciones de red: IPs, CIDRs, hostnames o URLs (con puerto si hace falta). */
const Addresses = z.array(z.string().min(1));

export const NODE_TYPES = [
  'datacenter',
  'cloud',
  'region',
  'zone',
  'network',
  'subnet',
  'cluster',
  'namespace',
  'server',
  'vm',
  'runtime',
  'device',
  'other',
] as const;
export const NodeType = z.enum(NODE_TYPES);
export type NodeType = z.infer<typeof NodeType>;

export const NodeDetails = z.object({
  type: NodeType,
  /** Proveedor del catálogo (`aws`, `azure`, `gcp`, `onprem`, `openshift`…). */
  provider: z.string().optional(),
  region: z.string().optional(),
  /** Cuenta, suscripción o proyecto. */
  account: z.string().optional(),
  /** Tamaño o tipo de instancia (`m5.2xlarge`, `Standard_D4s_v5`). */
  size: z.string().optional(),
  /** Cantidad de nodos iguales (C4: "x N"). */
  instances: z.number().int().positive().optional(),
});
export type NodeDetails = z.infer<typeof NodeDetails>;

/**
 * Nodo de despliegue: algo que ejecuta o aloja software (datacenter, nube, VPC, clúster,
 * namespace, servidor, VM…). Se anidan con `parent`.
 */
export const DeploymentNode = z.object({
  ...baseElement,
  kind: z.literal('node'),
  node: NodeDetails,
  technology: z.array(z.string()).optional(),
  addresses: Addresses.optional(),
  /** ID del recurso en el proveedor (`vpc-0a1b…`, `i-0123…`, ARN). */
  resource: z.string().optional(),
  risk: Risk.optional(),
});
export type DeploymentNode = z.infer<typeof DeploymentNode>;

export const INFRA_TYPES = [
  'firewall',
  'load-balancer',
  'dns',
  'gateway',
  'ingress',
  'egress',
  'nat',
  'vpn',
  'link',
  'security-group',
  'waf',
  'cdn',
  'proxy',
  'router',
  'other',
] as const;
export const InfraType = z.enum(INFRA_TYPES);
export type InfraType = z.infer<typeof InfraType>;

/** Nodo de infraestructura: no ejecuta el software pero el tráfico pasa por él (firewall, DNS, balanceador…). */
export const InfraNode = z.object({
  ...baseElement,
  kind: z.literal('infra'),
  infra: z.object({ type: InfraType }),
  technology: z.array(z.string()).optional(),
  addresses: Addresses.optional(),
  resource: z.string().optional(),
  risk: Risk.optional(),
});
export type InfraNode = z.infer<typeof InfraNode>;

/** Tipos que se pueden instanciar en un nodo de despliegue. */
export const INSTANCE_OF_KINDS = ['container', 'store', 'bus', 'system'] as const;

/** Instancia de un contenedor (o base, bus o sistema) desplegada en un nodo. */
export const Instance = z.object({
  ...baseElement,
  kind: z.literal('instance'),
  instance: z.object({
    /** Elemento desplegado (container, store, bus o system). */
    of: Id,
    /** Réplicas (pods, procesos). */
    replicas: z.number().int().positive().optional(),
  }),
  addresses: Addresses.optional(),
  resource: z.string().optional(),
});
export type Instance = z.infer<typeof Instance>;

export const Element = z.discriminatedUnion('kind', [
  Actor,
  System,
  Container,
  Component,
  Store,
  Bus,
  Group,
  DeploymentNode,
  InfraNode,
  Instance,
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
  /** Puertos de destino (`443`, `8080`). */
  ports: z.array(z.number().int().min(1).max(65535)).optional(),
  /** Por defecto `outgoing`. */
  direction: Direction.optional(),
  status: Status.optional(),
  tags: z.array(z.string()).optional(),
  properties: Properties.optional(),
  extensions: Extensions.optional(),
});
export type Relation = z.infer<typeof Relation>;

/** Niveles C4 (contexto, contenedores, componentes) y el diagrama de despliegue de un ambiente. */
export const LEVELS = [1, 2, 3, 'deployment'] as const;
export const Level = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal('deployment')]);
export type Level = z.infer<typeof Level>;
export type C4Level = Exclude<Level, 'deployment'>;

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
  /**
   * Elemento que se "abre": system en L2, container en L3. Vacío en L1. En despliegue, opcional:
   * el sistema cuyo despliegue se muestra.
   */
  scope: Id.optional(),
  /** Solo despliegue: ambiente que muestra (ID de un ambiente del workspace). */
  environment: Id.optional(),
  description: z.string().optional(),
  /** Posición (absoluta) de cada elemento ubicado en el lienzo, indexada por ID de elemento. */
  nodes: z.record(Id, NodeLayout),
  /** Estilo por relación (solo para las que se apartan del default). */
  edges: z.record(Id, EdgeStyle).optional(),
  extensions: Extensions.optional(),
});
export type View = z.infer<typeof View>;

/** Ambiente de despliegue (dev, qa, pre, prod…). El orden de la lista es el de la interfaz. */
export const Environment = z.object({
  id: Id,
  name: z.string().min(1),
});
export type Environment = z.infer<typeof Environment>;

export const FinOpsSettings = z.object({
  /** Moneda de los costos (código ISO 4217). Por defecto `USD`. */
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'Moneda inválida: usá un código ISO de tres letras (USD, EUR, ARS…)')
    .optional(),
  /** Claves de etiquetas FinOps que se sugieren al cargar costos. */
  tagKeys: z.array(z.string().min(1)).optional(),
  /** Presupuesto mensual por ambiente. */
  budgets: z.record(Id, z.number().nonnegative()).optional(),
});
export type FinOpsSettings = z.infer<typeof FinOpsSettings>;

export const WorkspaceMeta = z.object({
  schema: z.literal(SCHEMA_VERSION),
  id: Id,
  name: z.string().min(1),
  description: z.string().optional(),
  organization: z.string().optional(),
  architect: z.string().optional(),
  /** Código del documento o del cambio que lo motiva (ej. `ARQ-1024`, un ticket). */
  code: z.string().optional(),
  /** Versión del documento de arquitectura (`v1.9`). */
  version: z.string().optional(),
  /** Fecha de esa versión (ISO `AAAA-MM-DD`). */
  date: z.string().optional(),
  /** Lienzo que se abre por defecto. */
  defaultView: Id.optional(),
  environments: z.array(Environment).optional(),
  finops: FinOpsSettings.optional(),
  extensions: Extensions.optional(),
});
export type WorkspaceMeta = z.infer<typeof WorkspaceMeta>;

// -----------------------------------------------------------------------------------------------
// Flujos: secuencias de pasos sobre el modelo que se reproducen como presentación.

const stepBase = {
  /** Título corto (se muestra con el número del paso). */
  title: z.string().optional(),
  /** Detalle en Markdown: payload, endpoint, reglas… */
  description: z.string().optional(),
};

/** Un elemento le habla a otro (normalmente sobre una relación existente). */
export const MessageStep = z.object({
  ...stepBase,
  type: z.literal('message'),
  from: Id,
  to: Id,
  /** Relación que representa el mensaje; si falta, se busca la del par. */
  relation: Id.optional(),
});
/** Un elemento hace algo por su cuenta ("valida el token", "calcula el riesgo"). */
export const ProcessStep = z.object({ ...stepBase, type: z.literal('process'), element: Id });
/** Contexto sin elementos: una nota, un link, una aclaración. */
export const NoteStep = z.object({ ...stepBase, type: z.literal('note') });
/** Continúa en otro flujo (y vuelve al terminarlo). */
export const GotoStep = z.object({ ...stepBase, type: z.literal('goto'), flow: Id });

export const LeafStep = z.discriminatedUnion('type', [MessageStep, ProcessStep, NoteStep, GotoStep]);
export type LeafStep = z.infer<typeof LeafStep>;

export const FlowPath = z.object({
  name: z.string().min(1),
  steps: z.array(LeafStep),
});
export type FlowPath = z.infer<typeof FlowPath>;

/** Bifurcación: caminos alternativos (uno u otro) o paralelos (todos a la vez). */
export const PathsStep = z.object({
  ...stepBase,
  type: z.literal('paths'),
  mode: z.enum(['alternate', 'parallel']),
  paths: z.array(FlowPath).min(1),
});

export const FlowStep = z.discriminatedUnion('type', [MessageStep, ProcessStep, NoteStep, GotoStep, PathsStep]);
export type FlowStep = z.infer<typeof FlowStep>;
export type FlowStepType = FlowStep['type'];

export const Flow = z.object({
  id: Id,
  name: z.string().min(1),
  description: z.string().optional(),
  /** Lienzo donde se reproduce (los pasos con elementos de otro nivel abren el lienzo que los muestra). */
  view: Id.optional(),
  steps: z.array(FlowStep),
  extensions: Extensions.optional(),
});
export type Flow = z.infer<typeof Flow>;

// -----------------------------------------------------------------------------------------------
// Comentarios flotantes sobre un lienzo.

export const COMMENT_ICONS = ['message', 'info', 'question', 'warning', 'idea', 'check', 'flag', 'bug', 'lock', 'star'] as const;
export const CommentIcon = z.enum(COMMENT_ICONS);
export type CommentIcon = z.infer<typeof CommentIcon>;

export const COMMENT_COLORS = ['accent', 'ok', 'warn', 'danger', 'violet', 'neutral'] as const;
export const CommentColor = z.enum(COMMENT_COLORS);
export type CommentColor = z.infer<typeof CommentColor>;

export const CommentReply = z.object({
  author: z.string().min(1),
  /** Fecha ISO 8601. */
  at: z.string().min(1),
  body: z.string().min(1),
});
export type CommentReply = z.infer<typeof CommentReply>;

export const Comment = z.object({
  id: Id,
  view: Id,
  /**
   * Posición en el lienzo. Con `element`, es relativa a la esquina del elemento (el comentario se
   * mueve con él); sin `element`, es absoluta.
   */
  x: z.number(),
  y: z.number(),
  element: Id.optional(),
  /** Por defecto `message`. */
  icon: CommentIcon.optional(),
  /** Por defecto `accent`. */
  color: CommentColor.optional(),
  title: z.string().optional(),
  body: z.string().min(1),
  author: z.string().min(1),
  at: z.string().min(1),
  /** Última edición del texto (ISO 8601). */
  edited: z.string().optional(),
  resolved: z.boolean().optional(),
  replies: z.array(CommentReply).optional(),
});
export type Comment = z.infer<typeof Comment>;

/** Esquemas exportados como JSON Schema (para agentes de IA y editores YAML). */
export const jsonSchemas = {
  workspace: WorkspaceMeta,
  element: Element,
  relation: Relation,
  view: View,
  flow: Flow,
  comment: Comment,
} as const;
