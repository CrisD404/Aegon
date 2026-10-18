import {
  COMMENT_COLORS,
  COMMENT_ICONS,
  CONTAINER_TYPE_LABEL,
  CONTAINER_TYPES,
  DB_ENGINES,
  ELEMENT_KINDS,
  EXPORT_FORMATS,
  GROUP_PROVIDER_CATALOG,
  KIND_LABEL,
  MESSAGE_BROKERS,
  OpError,
  PROTOCOLS,
  RISKS,
  STATUSES,
  TECHNOLOGIES,
  analyzeModel,
  ancestorsOf,
  childViewOf,
  childrenOf,
  createViewOp,
  diffModels,
  ensureChildViewOp,
  exportModel,
  flowToText,
  indexOf,
  placeableElements,
  relationsOf,
  searchCatalog,
  sortedValues,
  suggestProtocols,
  viewEdges,
  viewsContaining,
  type CatalogItem,
  type CommentColor,
  type CommentIcon,
  type Element,
  type ElementPatch,
  type Model,
  type Op,
  type Relation,
  type RelationPatch,
  type WorkspacePatch,
} from '@aegon/core';
import {
  WorkspaceError,
  commentBrief,
  findComment,
  findFlow,
  flowBrief,
  flowDetail,
  listComments,
  normalizeProtocols,
  normalizeTechnologies,
  numberedStepAt,
  numberedSteps,
  planAddComment,
  planAddElement,
  planAddFlowStep,
  planConnect,
  planCreateFlow,
  planDeleteFlow,
  planLayout,
  planPlace,
  planReplyComment,
  planResolveComment,
  planUpdateFlow,
  type CommentStatus,
  type StepInput,
  type Workspace,
} from '@aegon/cli';
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Session } from './session.ts';

/**
 * Herramientas del servidor MCP: lectura (list/get), una por operación del modelo
 * (add/update/remove, connect, place, create_child_view…), validate y analyze. Toda escritura
 * pasa por `applyOp` (que valida) y se guarda en disco con `planWrite`.
 */

// ---------------------------------------------------------------------------------------------
// Esquemas comunes

const ref = (what: string) => z.string().min(1).describe(`ID (o nombre exacto) del ${what}`);
const position = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive().optional(),
  h: z.number().positive().optional(),
});
const kind = z.enum(ELEMENT_KINDS);
const status = z.enum(STATUSES);
const risk = z.enum(RISKS);
const patch = z.record(z.string(), z.unknown());

const leafStepShape = {
  type: z.enum(['message', 'process', 'note', 'goto']),
  title: z.string().optional().describe('Título corto. Sin título, un message muestra la etiqueta de su relación'),
  description: z.string().optional().describe('Detalle en Markdown: payload, endpoint, reglas…'),
  from: z.string().optional().describe('message: elemento que envía (ID o nombre)'),
  to: z.string().optional().describe('message: elemento que recibe (ID o nombre)'),
  relation: z.string().optional().describe('message: ID de la relación que lo representa (por defecto, la que une al par)'),
  element: z.string().optional().describe('process: elemento que hace el trabajo'),
  flow: z.string().optional().describe('goto: flujo en el que continúa (ID o nombre)'),
};
const leafStep = z.object(leafStepShape);
const stepShape = {
  ...leafStepShape,
  type: z
    .enum(['message', 'process', 'note', 'goto', 'paths'])
    .describe('message: un elemento le habla a otro · process: un elemento hace algo · note: contexto · goto: sigue en otro flujo · paths: bifurcación'),
  mode: z.enum(['alternate', 'parallel']).optional().describe('paths: alternate (uno u otro, por defecto) o parallel (a la vez)'),
  paths: z
    .array(z.union([z.string().min(1), z.object({ name: z.string().min(1), steps: z.array(leafStep).optional() })]))
    .optional()
    .describe('paths: los caminos, por nombre ("Aprobada") o con sus pasos ({"name": "Aprobada", "steps": [...]}). Un camino no contiene otra bifurcación'),
};
const step = z.object(stepShape);
const commentStatus = z.enum(['open', 'resolved', 'all']);
const DEFAULT_AUTHOR = 'Agente de IA';

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

// ---------------------------------------------------------------------------------------------
// Resultados

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown): CallToolResult {
  const text =
    err instanceof OpError || err instanceof WorkspaceError
      ? `${err.message} [${err.code}]`
      : `Error inesperado: ${err instanceof Error ? err.message : String(err)}`;
  return { isError: true, content: [{ type: 'text', text }] };
}

const files = (plan: { writes: ReadonlyMap<string, string>; deletes: readonly string[] }) => ({
  written: [...plan.writes.keys()].sort(),
  deleted: [...plan.deletes],
});

// ---------------------------------------------------------------------------------------------
// Vistas compactas del modelo (lo justo para que el agente decida, sin volcar todo)

function brief(el: Element) {
  const out: Record<string, unknown> = { id: el.id, kind: el.kind, name: el.name };
  if (el.parent) out.parent = el.parent;
  if (el.description) out.description = el.description;
  if ('technology' in el && el.technology?.length) out.technology = el.technology;
  if (el.kind === 'store') out.engine = el.store.engine;
  if (el.kind === 'bus') out.broker = el.bus.broker;
  if (el.kind === 'group') out.provider = el.group.provider;
  if (el.scope === 'external') out.external = true;
  if (el.status && el.status !== 'live') out.status = el.status;
  if ('risk' in el && el.risk) out.risk = el.risk;
  return out;
}

function relationBrief(model: Model, rel: Relation) {
  const out: Record<string, unknown> = {
    id: rel.id,
    from: rel.from,
    to: rel.to,
    name: `${model.elements[rel.from]?.name ?? rel.from} → ${model.elements[rel.to]?.name ?? rel.to}`,
  };
  if (rel.label) out.label = rel.label;
  if (rel.protocols?.length) out.protocols = rel.protocols;
  if (rel.direction === 'bidirectional') out.bidirectional = true;
  if (rel.status && rel.status !== 'live') out.status = rel.status;
  return out;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();


// ---------------------------------------------------------------------------------------------

export function registerTools(server: McpServer, session: Session): void {
  /** Envuelve un handler: workspace recién leído, resultado en JSON y errores como isError. */
  const handler = <A>(fn: (ws: Workspace, args: A) => unknown) => async (args: A) => {
    try {
      return ok(await session.run((ws) => fn(ws, args)));
    } catch (err) {
      return fail(err);
    }
  };
  const read = handler;
  const write = handler;

  /** Aplica una op y arma la respuesta común de las escrituras. */
  const apply = async (ws: Workspace, op: Op, summary: string, extra: Record<string, unknown> = {}) => {
    const { plan } = await ws.apply(op);
    return { ok: true, summary, ...extra, ...files(plan) };
  };

  // ----- Lectura ------------------------------------------------------------------------------

  server.registerTool(
    'get_workspace',
    {
      title: 'Resumen del workspace',
      description:
        'Nombre, carpeta, formato y conteos del workspace (elementos, relaciones, lienzos, flujos y comentarios), con la lista de lienzos (L1 contexto, L2 contenedores, L3 componentes). Empezá por acá.',
      inputSchema: z.object({}),
      annotations: READ,
    },
    read((ws) => {
      const m = ws.model;
      const byKind: Record<string, number> = {};
      for (const el of Object.values(m.elements)) byKind[el.kind] = (byKind[el.kind] ?? 0) + 1;
      const comments = Object.values(m.comments ?? {});
      return {
        workspace: m.workspace,
        root: ws.root,
        counts: {
          elements: Object.keys(m.elements).length,
          relations: Object.keys(m.relations).length,
          views: Object.keys(m.views).length,
          flows: Object.keys(m.flows ?? {}).length,
          comments: comments.length,
          openComments: comments.filter((c) => !c.resolved).length,
          byKind,
        },
        views: sortedValues(m.views).map((v) => ({ id: v.id, name: v.name, level: v.level, scope: v.scope, nodes: Object.keys(v.nodes).length })),
        diagnostics: { errors: ws.diagnostics.filter((d) => d.severity === 'error').length, warnings: ws.diagnostics.filter((d) => d.severity === 'warning').length },
      };
    }),
  );

  server.registerTool(
    'list_elements',
    {
      title: 'Listar elementos',
      description: 'Elementos del modelo (resumen). Filtros opcionales por tipo, padre, lienzo o texto.',
      inputSchema: z.object({
        kind: kind.optional().describe('actor, system, container, component, store (base de datos), bus (mensajería) o group'),
        parent: z.string().optional().describe('Solo hijos directos de este elemento (ID). "" = solo raíces'),
        view: z.string().optional().describe('Solo los ubicados en este lienzo (ID)'),
        query: z.string().optional().describe('Texto a buscar en ID, nombre o descripción'),
        limit: z.number().int().positive().max(1000).optional().describe('Máximo de resultados (por defecto 200)'),
      }),
      annotations: READ,
    },
    read((ws, args: { kind?: Element['kind']; parent?: string; view?: string; query?: string; limit?: number }) => {
      const m = ws.model;
      let items = sortedValues(m.elements);
      if (args.kind) items = items.filter((el) => el.kind === args.kind);
      if (args.parent !== undefined) {
        const parent = args.parent === '' ? undefined : ws.element(args.parent).id;
        items = items.filter((el) => el.parent === parent);
      }
      if (args.view) {
        const view = ws.view(args.view);
        items = items.filter((el) => view.nodes[el.id]);
      }
      if (args.query) {
        const q = norm(args.query);
        items = items.filter((el) => norm(`${el.id} ${el.name} ${el.description ?? ''}`).includes(q));
      }
      const limit = args.limit ?? 200;
      return { total: items.length, truncated: items.length > limit, elements: items.slice(0, limit).map(brief) };
    }),
  );

  server.registerTool(
    'get_element',
    {
      title: 'Ver elemento',
      description: 'Un elemento completo con sus ancestros, hijos, relaciones entrantes/salientes, lienzos donde aparece y su lienzo de detalle (L2/L3) si existe.',
      inputSchema: z.object({ id: ref('elemento') }),
      annotations: READ,
    },
    read((ws, args: { id: string }) => {
      const m = ws.model;
      const el = ws.element(args.id);
      const rels = relationsOf(m, el.id);
      return {
        element: el,
        ancestors: ancestorsOf(m, el.id).map(brief),
        children: childrenOf(m, el.id).map(brief),
        members: el.kind === 'group' ? (indexOf(m).membersOf.get(el.id) ?? []) : undefined,
        relations: { outgoing: rels.outgoing.map((r) => relationBrief(m, r)), incoming: rels.incoming.map((r) => relationBrief(m, r)) },
        views: viewsContaining(m, el.id).map((v) => ({ id: v.id, name: v.name, level: v.level })),
        childView: childViewOf(m, el.id)?.id ?? null,
        file: ws.fileOf('element', el.id) ?? null,
      };
    }),
  );

  server.registerTool(
    'list_relations',
    {
      title: 'Listar relaciones',
      description: 'Relaciones del modelo. Filtros opcionales: las de un elemento, por origen/destino o solo las que no declaran protocolos.',
      inputSchema: z.object({
        element: z.string().optional().describe('Relaciones que entran o salen de este elemento'),
        from: z.string().optional(),
        to: z.string().optional(),
        withoutProtocols: z.boolean().optional().describe('Solo las que no tienen protocols'),
      }),
      annotations: READ,
    },
    read((ws, args: { element?: string; from?: string; to?: string; withoutProtocols?: boolean }) => {
      const m = ws.model;
      let items = sortedValues(m.relations);
      if (args.element) {
        const id = ws.element(args.element).id;
        items = items.filter((r) => r.from === id || r.to === id);
      }
      if (args.from) {
        const id = ws.element(args.from).id;
        items = items.filter((r) => r.from === id);
      }
      if (args.to) {
        const id = ws.element(args.to).id;
        items = items.filter((r) => r.to === id);
      }
      if (args.withoutProtocols) items = items.filter((r) => !r.protocols?.length);
      return { total: items.length, relations: items.map((r) => relationBrief(m, r)) };
    }),
  );

  server.registerTool(
    'get_relation',
    {
      title: 'Ver relación',
      description: 'Una relación completa, con los nombres de sus extremos.',
      inputSchema: z.object({ id: z.string().min(1).describe('ID de la relación (ej. "web-app--api-gateway")') }),
      annotations: READ,
    },
    read((ws, args: { id: string }) => {
      const rel = ws.model.relations[args.id];
      if (!rel) throw new WorkspaceError('not-found', `No existe la relación "${args.id}"`);
      return { relation: rel, from: brief(ws.model.elements[rel.from]!), to: brief(ws.model.elements[rel.to]!), file: ws.fileOf('relation', rel.id) ?? null };
    }),
  );

  server.registerTool(
    'list_views',
    {
      title: 'Listar lienzos',
      description: 'Lienzos (diagramas): nivel 1 = contexto, 2 = contenedores de un sistema, 3 = componentes de un contenedor.',
      inputSchema: z.object({}),
      annotations: READ,
    },
    read((ws) => ({
      defaultView: ws.model.workspace.defaultView ?? null,
      views: sortedValues(ws.model.views).map((v) => ({
        id: v.id,
        name: v.name,
        level: v.level,
        scope: v.scope ?? null,
        description: v.description,
        nodes: Object.keys(v.nodes).length,
      })),
    })),
  );

  server.registerTool(
    'get_view',
    {
      title: 'Ver lienzo',
      description:
        'Un lienzo: nodos ubicados (con posición y tamaño), relaciones visibles (las implícitas se dibujan entre ancestros) y elementos que todavía se pueden ubicar.',
      inputSchema: z.object({ id: ref('lienzo') }),
      annotations: READ,
    },
    read((ws, args: { id: string }) => {
      const m = ws.model;
      const view = ws.view(args.id);
      const placeable = placeableElements(m, view);
      return {
        view: { id: view.id, name: view.name, level: view.level, scope: view.scope ?? null, description: view.description },
        nodes: Object.entries(view.nodes)
          .filter(([id]) => m.elements[id])
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, l]) => ({ ...brief(m.elements[id]!), x: l.x, y: l.y, ...(l.w ? { w: l.w } : {}), ...(l.h ? { h: l.h } : {}) })),
        edges: viewEdges(m, view).map((e) => ({
          from: e.from,
          to: e.to,
          relations: e.relations.map((r) => r.id),
          label: e.relations.map((r) => r.label).filter(Boolean).join(' / ') || undefined,
          ...(e.implied ? { implied: true } : {}),
          ...(e.bidirectional ? { bidirectional: true } : {}),
        })),
        placeable: { total: placeable.length, elements: placeable.slice(0, 50).map((el) => ({ id: el.id, kind: el.kind, name: el.name })) },
      };
    }),
  );

  server.registerTool(
    'search_catalog',
    {
      title: 'Buscar en los catálogos',
      description:
        'IDs válidos para technology (tecnologías), store.engine (motores de base de datos), bus.broker (brokers), protocols (protocolos) y group.provider. Con catalog=protocols y `target`, ordena los protocolos según el destino (JDBC hacia PostgreSQL, Kafka hacia un bus Kafka…).',
      inputSchema: z.object({
        catalog: z.enum(['technologies', 'engines', 'brokers', 'protocols', 'providers', 'containerTypes']),
        query: z.string().optional().describe('Texto a buscar (nombre, ID o palabra clave)'),
        target: z.string().optional().describe('Solo protocols: elemento destino de la relación'),
        limit: z.number().int().positive().max(100).optional(),
      }),
      annotations: READ,
    },
    read((ws, args: { catalog: string; query?: string; target?: string; limit?: number }) => {
      const limit = args.limit ?? 20;
      const pick = <T extends CatalogItem>(items: readonly T[], extra: (i: T) => Record<string, unknown> = () => ({})) =>
        searchCatalog(items, args.query ?? '', limit).map((i) => ({ id: i.id, name: i.name, ...extra(i) }));
      switch (args.catalog) {
        case 'technologies':
          return pick(TECHNOLOGIES, (t) => ({ category: t.category }));
        case 'engines':
          return pick(DB_ENGINES, (e) => ({ type: e.type }));
        case 'brokers':
          return pick(MESSAGE_BROKERS, (b) => ({ type: b.type, protocol: b.protocol }));
        case 'protocols': {
          const target = args.target ? ws.element(args.target) : undefined;
          const items = target ? suggestProtocols(target, args.query ?? '', limit) : searchCatalog(PROTOCOLS, args.query ?? '', limit);
          return items.map((p) => ({ id: p.id, name: p.name, group: p.group }));
        }
        case 'providers':
          return pick(GROUP_PROVIDER_CATALOG);
        default:
          return CONTAINER_TYPES.map((t) => ({ id: t, name: CONTAINER_TYPE_LABEL[t] }));
      }
    }),
  );

  server.registerTool(
    'validate',
    {
      title: 'Validar',
      description: 'Valida el workspace: sintaxis y esquema de los YAML, referencias rotas y reglas C4. ok=false si hay errores.',
      inputSchema: z.object({ includeInfo: z.boolean().optional().describe('Incluir diagnósticos informativos (elementos fuera de todo lienzo)') }),
      annotations: READ,
    },
    read((ws, args: { includeInfo?: boolean }) => {
      const diagnostics = ws.validate({ info: !!args.includeInfo });
      const errors = diagnostics.filter((d) => d.severity === 'error').length;
      return { ok: errors === 0, errors, warnings: diagnostics.filter((d) => d.severity === 'warning').length, diagnostics };
    }),
  );

  server.registerTool(
    'analyze',
    {
      title: 'Analizar',
      description:
        'Análisis de calidad: huérfanos (sin relaciones), ciclos de dependencias, violaciones C4, relaciones sin protocolo (con sugerencias) y hotspots de riesgo (riesgo alto/crítico, deprecados en uso, mucha dependencia).',
      inputSchema: z.object({ hotspotLimit: z.number().int().positive().max(100).optional() }),
      annotations: READ,
    },
    read((ws, args: { hotspotLimit?: number }) => analyzeModel(ws.model, { hotspotLimit: args.hotspotLimit ?? 10 })),
  );

  server.registerTool(
    'export',
    {
      title: 'Exportar',
      description: 'Exporta a Mermaid (flowchart), C4-PlantUML, Structurizr DSL o JSON. Sin `view` exporta todos los lienzos.',
      inputSchema: z.object({ format: z.enum(EXPORT_FORMATS), view: z.string().optional().describe('Solo este lienzo') }),
      annotations: READ,
    },
    async (args: { format: (typeof EXPORT_FORMATS)[number]; view?: string }) => {
      try {
        const text = await session.run((ws) => exportModel(ws.model, args.format, args.view ? { view: ws.view(args.view).id } : {}));
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ----- Elementos ----------------------------------------------------------------------------

  server.registerTool(
    'add_element',
    {
      title: 'Agregar elemento',
      description:
        'Crea un elemento. Con `view` lo ubica en ese lienzo (en un lugar libre si no indicás x/y) y, en un lienzo L2/L3, hereda el padre (un container nuevo en el lienzo de contenedores de un sistema queda dentro de ese sistema). El ID se genera del nombre si no lo pasás.',
      inputSchema: z.object({
        kind,
        name: z.string().min(1),
        id: z.string().optional().describe('ID explícito (slug). Por defecto, el slug del nombre'),
        parent: z.string().optional().describe('Padre: container → system, component → container, store → system o container, bus → system, group → group'),
        view: z.string().optional().describe('Lienzo donde ubicarlo'),
        x: z.number().optional(),
        y: z.number().optional(),
        description: z.string().optional().describe('Descripción corta (se ve en el nodo)'),
        docs: z.string().optional().describe('Documentación larga en Markdown'),
        technology: z.array(z.string()).optional().describe('Solo system/container/component: IDs del catálogo (java, spring-boot, react, go, nodejs…)'),
        containerType: z.enum(CONTAINER_TYPES).optional(),
        role: z.string().optional().describe('Solo actor: rol o persona'),
        engine: z.string().optional().describe('Solo store: motor (postgresql, mysql, mongodb, redis, dynamodb, s3…)'),
        broker: z.string().optional().describe('Solo bus: broker (kafka, rabbitmq, sqs, sns, pubsub…)'),
        topics: z.array(z.string()).optional().describe('Solo bus: tópicos o colas'),
        provider: z.string().optional().describe('Solo group: aws, gcp, azure, onprem, network, platform u other'),
        region: z.string().optional().describe('Solo group'),
        external: z.boolean().optional().describe('Elemento externo a la organización'),
        status: status.optional(),
        risk: risk.optional(),
        tags: z.array(z.string()).optional(),
        owner: z.string().optional(),
        groups: z.array(z.string()).optional().describe('Grupos (IDs) a los que pertenece'),
      }),
      annotations: WRITE,
    },
    write(async (ws, args: { kind: Element['kind']; name: string; x?: number; y?: number } & Record<string, unknown>) => {
      if ((args.x === undefined) !== (args.y === undefined)) throw new WorkspaceError('invalid-position', 'Indicá x e y juntos');
      const { x, y, ...rest } = args;
      const plan = planAddElement(ws.model, { ...(rest as Parameters<typeof planAddElement>[1]), at: x !== undefined && y !== undefined ? { x, y } : undefined });
      const where = plan.view ? `, ubicado en ${plan.view} (${plan.position!.x}, ${plan.position!.y})` : '';
      const result = await apply(ws, plan.op, `${KIND_LABEL[plan.element.kind]} "${plan.element.name}" agregado (${plan.id})${where}`, { id: plan.id, warnings: plan.warnings });
      return { ...result, element: ws.model.elements[plan.id] };
    }),
  );

  server.registerTool(
    'update_element',
    {
      title: 'Modificar elemento',
      description:
        'Cambia campos de un elemento. `patch` reemplaza cada campo indicado; null lo borra. Ej: {"name": "Pagos API v2", "risk": "high", "description": null}. El ID y el tipo no se pueden cambiar (para renombrar cambiá name).',
      inputSchema: z.object({ id: ref('elemento'), patch: patch.describe('Campos a cambiar (null = borrar)') }),
      annotations: WRITE,
    },
    write(async (ws, args: { id: string; patch: Record<string, unknown> }) => {
      const el = ws.element(args.id);
      const warnings: string[] = [];
      const p = { ...args.patch } as ElementPatch;
      if (Array.isArray(p.technology)) p.technology = normalizeTechnologies(p.technology as string[], warnings);
      const result = await apply(ws, { type: 'element.update', id: el.id, patch: p }, `"${el.name}" actualizado (${Object.keys(p).join(', ')})`, { id: el.id, warnings });
      return { ...result, element: ws.model.elements[el.id] };
    }),
  );

  server.registerTool(
    'remove_element',
    {
      title: 'Eliminar elemento',
      description: 'Elimina un elemento del modelo en cascada: sus hijos, sus relaciones, sus lienzos de detalle y su ubicación en todos los lienzos.',
      inputSchema: z.object({ id: ref('elemento') }),
      annotations: DESTRUCTIVE,
    },
    write(async (ws, args: { id: string }) => {
      const el = ws.element(args.id);
      const before = ws.model;
      const result = await apply(ws, { type: 'element.remove', id: el.id }, `"${el.name}" eliminado`);
      const removed = diffModels(before, ws.model)
        .filter((c) => c.kind === 'removed')
        .map((c) => ({ entity: c.entity, id: c.id, name: c.name }));
      return { ...result, removed };
    }),
  );

  // ----- Relaciones ---------------------------------------------------------------------------

  server.registerTool(
    'connect',
    {
      title: 'Conectar elementos',
      description:
        'Crea la relación from → to. En C4 hay una sola relación por par: si ya existe al revés se vuelve bidireccional; si ya existe, se completa con lo indicado. Conectá los elementos más específicos (container → container): Aegon dibuja solo las relaciones implícitas entre sistemas.',
      inputSchema: z.object({
        from: ref('elemento origen'),
        to: ref('elemento destino'),
        label: z.string().optional().describe('Qué hace: "Lee y escribe", "Publica pagos"'),
        description: z.string().optional(),
        protocols: z.array(z.string()).optional().describe('IDs del catálogo: https, rest, grpc, graphql, kafka, amqp, jdbc, sql, resp, s3-api, sftp, oidc…'),
        bidirectional: z.boolean().optional(),
        status: status.optional(),
      }),
      annotations: WRITE,
    },
    write(async (ws, args: { from: string; to: string; label?: string; description?: string; protocols?: string[]; bidirectional?: boolean; status?: Relation['status'] }) => {
      const plan = planConnect(ws.model, { ...args, direction: args.bidirectional ? 'bidirectional' : undefined });
      const names = `${ws.model.elements[plan.from]!.name} → ${ws.model.elements[plan.to]!.name}`;
      const text = { created: 'Relación creada', bidirectional: 'Relación ahora bidireccional', updated: 'Relación actualizada', exists: 'Ya estaban conectados, sin cambios' }[plan.result];
      const extra = { result: plan.result, id: plan.id, warnings: plan.warnings, suggestedProtocols: plan.suggestions };
      const result = plan.op ? await apply(ws, plan.op, `${text}: ${names} (${plan.id})`, extra) : { ok: true, summary: `${text}: ${names} (${plan.id})`, ...extra, written: [], deleted: [] };
      return { ...result, relation: ws.model.relations[plan.id] };
    }),
  );

  server.registerTool(
    'update_relation',
    {
      title: 'Modificar relación',
      description: 'Cambia campos de una relación (label, description, protocols, direction, status, tags, from, to). null borra el campo.',
      inputSchema: z.object({ id: z.string().min(1), patch: patch.describe('Campos a cambiar (null = borrar)') }),
      annotations: WRITE,
    },
    write(async (ws, args: { id: string; patch: Record<string, unknown> }) => {
      const warnings: string[] = [];
      const p = { ...args.patch } as RelationPatch;
      if (Array.isArray(p.protocols)) p.protocols = normalizeProtocols(p.protocols, warnings);
      const result = await apply(ws, { type: 'relation.update', id: args.id, patch: p }, `Relación ${args.id} actualizada`, { id: args.id, warnings });
      return { ...result, relation: ws.model.relations[args.id] };
    }),
  );

  server.registerTool(
    'remove_relation',
    {
      title: 'Eliminar relación',
      description: 'Elimina una relación (y su estilo en los lienzos).',
      inputSchema: z.object({ id: z.string().min(1) }),
      annotations: DESTRUCTIVE,
    },
    write((ws, args: { id: string }) => apply(ws, { type: 'relation.remove', id: args.id }, `Relación ${args.id} eliminada`)),
  );

  // ----- Lienzos ------------------------------------------------------------------------------

  server.registerTool(
    'create_view',
    {
      title: 'Crear lienzo L1',
      description: 'Crea un lienzo de contexto (nivel 1) vacío. Para L2/L3 usá create_child_view.',
      inputSchema: z.object({ name: z.string().min(1), description: z.string().optional() }),
      annotations: WRITE,
    },
    write(async (ws, args: { name: string; description?: string }) => {
      const { op, id } = createViewOp(ws.model, args.name, 1);
      const final: Op = args.description && op.type === 'view.add' ? { ...op, view: { ...op.view, description: args.description } } : op;
      return apply(ws, final, `Lienzo "${args.name}" creado (${id})`, { id });
    }),
  );

  server.registerTool(
    'create_child_view',
    {
      title: 'Abrir lienzo de detalle',
      description:
        'Lienzo L2 (contenedores) de un sistema o L3 (componentes) de un contenedor. Si no existe, lo crea con sus hijos y los elementos externos con los que se relacionan, ya ubicados.',
      inputSchema: z.object({ element: ref('sistema o contenedor') }),
      annotations: WRITE,
    },
    write(async (ws, args: { element: string }) => {
      const el = ws.element(args.element);
      const result = ensureChildViewOp(ws.model, el.id);
      if (!result) throw new WorkspaceError('invalid-scope', `Solo un sistema (L2) o un contenedor (L3) tienen lienzo de detalle; "${el.name}" es un ${el.kind}`);
      if (!result.op) return { ok: true, created: false, id: result.viewId, summary: `"${el.name}" ya tiene su lienzo ${result.viewId}`, written: [], deleted: [] };
      const out = await apply(ws, result.op, `Lienzo ${result.viewId} creado`, { created: true, id: result.viewId });
      return { ...out, nodes: Object.keys(ws.model.views[result.viewId]!.nodes) };
    }),
  );

  server.registerTool(
    'update_view',
    {
      title: 'Modificar lienzo',
      description: 'Cambia el nombre o la descripción de un lienzo.',
      inputSchema: z.object({ id: ref('lienzo'), name: z.string().min(1).optional(), description: z.string().nullable().optional() }),
      annotations: WRITE,
    },
    write(async (ws, args: { id: string; name?: string; description?: string | null }) => {
      const view = ws.view(args.id);
      const p: Record<string, unknown> = {};
      if (args.name !== undefined) p.name = args.name;
      if (args.description !== undefined) p.description = args.description;
      return apply(ws, { type: 'view.update', id: view.id, patch: p }, `Lienzo ${view.id} actualizado`, { id: view.id });
    }),
  );

  server.registerTool(
    'remove_view',
    {
      title: 'Eliminar lienzo',
      description: 'Elimina un lienzo. Los elementos siguen en el modelo.',
      inputSchema: z.object({ id: ref('lienzo') }),
      annotations: DESTRUCTIVE,
    },
    write(async (ws, args: { id: string }) => {
      const view = ws.view(args.id);
      return apply(ws, { type: 'view.remove', id: view.id }, `Lienzo ${view.id} eliminado`);
    }),
  );

  server.registerTool(
    'place',
    {
      title: 'Ubicar en un lienzo',
      description:
        'Ubica elementos existentes en un lienzo (el mismo elemento del modelo, no una copia). Con `positions` los mueve a esas coordenadas; sin posición, los nuevos van a un lugar libre y los ya ubicados no se mueven.',
      inputSchema: z.object({
        view: ref('lienzo'),
        elements: z.array(z.string()).optional().describe('IDs a ubicar'),
        positions: z.record(z.string(), position).optional().describe('Posición explícita por ID: {"api": {"x": 0, "y": 200}}'),
      }),
      annotations: WRITE,
    },
    write(async (ws, args: { view: string; elements?: string[]; positions?: Record<string, { x: number; y: number; w?: number; h?: number }> }) => {
      const plan = planPlace(ws.model, args.view, args.elements ?? [], args.positions ?? {});
      if (!plan.op) return { ok: true, summary: 'Nada que ubicar', view: plan.view, skipped: plan.skipped, written: [], deleted: [] };
      return apply(ws, plan.op, `${Object.keys(plan.nodes).length} elemento(s) ubicados en ${plan.view}`, { view: plan.view, nodes: plan.nodes, skipped: plan.skipped });
    }),
  );

  server.registerTool(
    'unplace',
    {
      title: 'Quitar de un lienzo',
      description: 'Quita elementos de un lienzo sin borrarlos del modelo.',
      inputSchema: z.object({ view: ref('lienzo'), elements: z.array(z.string()).min(1) }),
      annotations: WRITE,
    },
    write(async (ws, args: { view: string; elements: string[] }) => {
      const view = ws.view(args.view);
      const ids = args.elements.map((r) => ws.element(r).id);
      return apply(ws, { type: 'view.unplace', view: view.id, ids }, `${ids.length} elemento(s) quitados de ${view.id}`, { view: view.id, ids });
    }),
  );

  server.registerTool(
    'layout_view',
    {
      title: 'Ordenar lienzo',
      description: 'Ordena automáticamente un lienzo (por capas siguiendo las relaciones, como Shift+L en la app). Con `elements` ordena solo esos.',
      inputSchema: z.object({ view: ref('lienzo'), elements: z.array(z.string()).optional() }),
      annotations: WRITE,
    },
    write(async (ws, args: { view: string; elements?: string[] }) => {
      const plan = planLayout(ws.model, args.view, args.elements);
      if (!plan.op) return { ok: true, summary: `El lienzo ${plan.view} ya está ordenado`, moved: 0, written: [], deleted: [] };
      return apply(ws, plan.op, `Lienzo ${plan.view} ordenado (${plan.moved} nodos movidos)`, { view: plan.view, moved: plan.moved });
    }),
  );

  server.registerTool(
    'set_edge_style',
    {
      title: 'Estilo de una relación en un lienzo',
      description: 'Forma de la línea (curved, straight, step) u ocultarla en un lienzo puntual. Sin shape ni hidden vuelve al estilo por defecto.',
      inputSchema: z.object({ view: ref('lienzo'), relation: z.string().min(1), shape: z.enum(['curved', 'straight', 'step']).optional(), hidden: z.boolean().optional() }),
      annotations: WRITE,
    },
    write(async (ws, args: { view: string; relation: string; shape?: 'curved' | 'straight' | 'step'; hidden?: boolean }) => {
      const view = ws.view(args.view);
      if (!ws.model.relations[args.relation]) throw new WorkspaceError('not-found', `No existe la relación "${args.relation}"`);
      const style: { shape?: 'curved' | 'straight' | 'step'; hidden?: boolean } = {};
      if (args.shape && args.shape !== 'curved') style.shape = args.shape;
      if (args.hidden) style.hidden = true;
      return apply(ws, { type: 'view.edge', view: view.id, relation: args.relation, style: Object.keys(style).length ? style : null }, `Estilo de ${args.relation} en ${view.id} actualizado`);
    }),
  );

  // ----- Flujos -------------------------------------------------------------------------------

  server.registerTool(
    'list_flows',
    {
      title: 'Listar flujos',
      description:
        'Flujos: recorridos paso a paso por la arquitectura (quién le habla a quién y en qué orden) que la app reproduce como presentación. Filtro opcional: los que involucran a un elemento.',
      inputSchema: z.object({ element: z.string().optional().describe('Solo los flujos con algún paso sobre este elemento') }),
      annotations: READ,
    },
    read((ws, args: { element?: string }) => {
      let items = sortedValues(ws.model.flows ?? {}).map(flowBrief);
      if (args.element) {
        const id = ws.element(args.element).id;
        items = items.filter((f) => f.elements.includes(id));
      }
      return { total: items.length, flows: items };
    }),
  );

  server.registerTool(
    'get_flow',
    {
      title: 'Ver flujo',
      description:
        'Un flujo completo: `flow` tal como está en el YAML (para editarlo con update_flow), `steps` numerados como en la app (1, 2, 5A.1…) con su título visible y la relación que dibuja cada mensaje, `text` legible y los avisos de validación.',
      inputSchema: z.object({ id: ref('flujo') }),
      annotations: READ,
    },
    read((ws, args: { id: string }) => {
      const flow = findFlow(ws.model, args.id);
      return { ...flowDetail(ws.model, flow), text: flowToText(ws.model, flow), file: ws.fileOf('flow', flow.id) ?? null };
    }),
  );

  server.registerTool(
    'create_flow',
    {
      title: 'Crear flujo',
      description:
        'Crea un flujo, vacío o con sus pasos. Los mensajes usan la relación entre sus extremos (conectalos antes con connect; si no hay relación se avisa y la app dibuja una flecha temporal). `view` es el lienzo donde arranca la presentación (los pasos con elementos de otro nivel abren el lienzo que los muestra).',
      inputSchema: z.object({
        name: z.string().min(1),
        id: z.string().optional().describe('ID explícito (slug). Por defecto, el slug del nombre'),
        description: z.string().optional(),
        view: z.string().optional().describe('Lienzo donde se reproduce (ID o nombre)'),
        steps: z.array(step).optional().describe('Pasos en orden (mismo formato que add_flow_step)'),
      }),
      annotations: WRITE,
    },
    write(async (ws, args: { name: string; id?: string; description?: string; view?: string; steps?: StepInput[] }) => {
      const plan = planCreateFlow(ws.model, args);
      const result = await apply(ws, plan.op, `Flujo "${args.name}" creado (${plan.id})`, { id: plan.id, warnings: plan.warnings });
      return { ...result, steps: numberedSteps(ws.model, ws.model.flows![plan.id]!) };
    }),
  );

  server.registerTool(
    'add_flow_step',
    {
      title: 'Agregar paso a un flujo',
      description:
        'Agrega un paso al final del flujo (o en `position`). Con `path` ("5A" = camino A del paso 5) lo agrega dentro de ese camino de una bifurcación. Para bifurcar, agregá un paso paths con los nombres de los caminos y después sus pasos con `path`. Devuelve el número del paso nuevo (`step`) y cómo quedó (`added`); get_flow trae el flujo entero.',
      inputSchema: z.object({
        id: ref('flujo'),
        ...stepShape,
        path: z.string().optional().describe('Camino donde agregarlo: número del paso paths + letra ("5A")'),
        position: z.number().int().positive().optional().describe('Posición (desde 1) en el flujo o en el camino. Por defecto, al final'),
      }),
      annotations: WRITE,
    },
    write(async (ws, args: StepInput & { id: string; path?: string; position?: number }) => {
      const { id, path, position, ...input } = args;
      const plan = planAddFlowStep(ws.model, id, input, { path, position });
      const result = await apply(ws, plan.op, `Paso ${plan.label} agregado a "${plan.flow.name}"`, { id: plan.flow.id, step: plan.label, warnings: plan.warnings });
      const flow = ws.model.flows![plan.flow.id]!;
      return { ...result, added: numberedStepAt(ws.model, flow, plan.label), totalSteps: flow.steps.length };
    }),
  );

  server.registerTool(
    'update_flow',
    {
      title: 'Modificar flujo',
      description:
        'Cambia nombre, descripción o lienzo de un flujo (null borra description/view). `steps` reemplaza la lista completa de pasos: así se reordenan, editan o quitan (partí de `flow.steps` de get_flow).',
      inputSchema: z.object({
        id: ref('flujo'),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        view: z.string().nullable().optional().describe('Lienzo donde se reproduce (ID o nombre)'),
        steps: z.array(step).optional().describe('Lista completa de pasos (reemplaza la actual)'),
      }),
      annotations: WRITE,
    },
    write(async (ws, args: { id: string; name?: string; description?: string | null; view?: string | null; steps?: StepInput[] }) => {
      const { id, ...input } = args;
      const plan = planUpdateFlow(ws.model, id, input);
      if (!plan.fields.length) throw new WorkspaceError('empty-patch', 'Indicá qué cambiar: name, description, view o steps');
      const result = await apply(ws, plan.op, `Flujo "${plan.flow.name}" actualizado (${plan.fields.join(', ')})`, { id: plan.flow.id, warnings: plan.warnings });
      return { ...result, steps: numberedSteps(ws.model, ws.model.flows![plan.flow.id]!) };
    }),
  );

  server.registerTool(
    'delete_flow',
    {
      title: 'Eliminar flujo',
      description: 'Elimina un flujo. Avisa si otros flujos continuaban en él (sus pasos goto quedan rotos).',
      inputSchema: z.object({ id: ref('flujo') }),
      annotations: DESTRUCTIVE,
    },
    write(async (ws, args: { id: string }) => {
      const plan = planDeleteFlow(ws.model, args.id);
      return apply(ws, plan.op, `Flujo "${plan.flow.name}" eliminado`, { id: plan.flow.id, warnings: plan.warnings });
    }),
  );

  // ----- Comentarios --------------------------------------------------------------------------

  server.registerTool(
    'list_comments',
    {
      title: 'Listar comentarios',
      description: 'Comentarios sobre los lienzos (notas, preguntas, advertencias) con sus respuestas, en orden cronológico. Filtros por lienzo, elemento anclado y estado.',
      inputSchema: z.object({
        view: z.string().optional().describe('Solo los de este lienzo (ID o nombre)'),
        element: z.string().optional().describe('Solo los anclados a este elemento'),
        status: commentStatus.optional().describe('open (sin resolver), resolved o all (por defecto)'),
      }),
      annotations: READ,
    },
    read((ws, args: { view?: string; element?: string; status?: CommentStatus }) => {
      const items = listComments(ws.model, args);
      return {
        total: items.length,
        open: items.filter((c) => !c.resolved).length,
        resolved: items.filter((c) => c.resolved).length,
        comments: items.map((c) => commentBrief(ws.model, c)),
      };
    }),
  );

  server.registerTool(
    'add_comment',
    {
      title: 'Comentar',
      description:
        'Deja un comentario en un lienzo. Con `element` queda anclado a ese elemento (se mueve con él) y, sin `view`, va al lienzo donde el elemento está con sus hermanos. Sin x/y se ubica solo (junto al elemento o a la derecha del contenido).',
      inputSchema: z.object({
        body: z.string().min(1).describe('Texto del comentario'),
        view: z.string().optional().describe('Lienzo (ID o nombre)'),
        element: z.string().optional().describe('Elemento al que se ancla (tiene que estar ubicado en el lienzo)'),
        title: z.string().optional(),
        icon: z.enum(COMMENT_ICONS).optional().describe('Por defecto message'),
        color: z.enum(COMMENT_COLORS).optional().describe('Por defecto accent'),
        x: z.number().optional().describe('Posición; anclado, relativa a la esquina del elemento'),
        y: z.number().optional(),
        author: z.string().min(1).optional().describe(`Firma. Por defecto "${DEFAULT_AUTHOR}"`),
      }),
      annotations: WRITE,
    },
    write(async (ws, args: { body: string; view?: string; element?: string; title?: string; icon?: CommentIcon; color?: CommentColor; x?: number; y?: number; author?: string }) => {
      const { comment, op } = planAddComment(ws.model, { ...args, author: args.author ?? DEFAULT_AUTHOR });
      const where = comment.element ? `${comment.view}, anclado a ${comment.element}` : comment.view;
      const result = await apply(ws, op, `Comentario agregado en ${where} (${comment.id})`, { id: comment.id });
      return { ...result, comment: commentBrief(ws.model, ws.model.comments![comment.id]!) };
    }),
  );

  server.registerTool(
    'reply_comment',
    {
      title: 'Responder comentario',
      description: 'Agrega una respuesta al hilo de un comentario.',
      inputSchema: z.object({
        id: z.string().min(1).describe('ID del comentario'),
        body: z.string().min(1),
        author: z.string().min(1).optional().describe(`Firma. Por defecto "${DEFAULT_AUTHOR}"`),
      }),
      annotations: WRITE,
    },
    write(async (ws, args: { id: string; body: string; author?: string }) => {
      const { op, comment } = planReplyComment(ws.model, args.id, { body: args.body, author: args.author ?? DEFAULT_AUTHOR });
      const result = await apply(ws, op, `Respuesta agregada al comentario ${comment.id}`, { id: comment.id });
      return { ...result, comment: commentBrief(ws.model, ws.model.comments![comment.id]!) };
    }),
  );

  server.registerTool(
    'resolve_comment',
    {
      title: 'Resolver comentario',
      description: 'Marca un comentario como resuelto (la app lo muestra atenuado, con un tilde) o, con resolved=false, lo reabre.',
      inputSchema: z.object({ id: z.string().min(1).describe('ID del comentario'), resolved: z.boolean().optional().describe('false lo reabre. Por defecto true') }),
      annotations: WRITE,
    },
    write(async (ws, args: { id: string; resolved?: boolean }) => {
      const resolved = args.resolved ?? true;
      const { op, comment } = planResolveComment(ws.model, args.id, resolved);
      const verb = resolved ? 'resuelto' : 'reabierto';
      if (!op) return { ok: true, summary: `El comentario ${comment.id} ya estaba ${resolved ? 'resuelto' : 'abierto'}`, id: comment.id, written: [], deleted: [] };
      return apply(ws, op, `Comentario ${comment.id} ${verb}`, { id: comment.id });
    }),
  );

  server.registerTool(
    'delete_comment',
    {
      title: 'Eliminar comentario',
      description: 'Elimina un comentario con sus respuestas. Para cerrarlo sin perder el hilo, usá resolve_comment.',
      inputSchema: z.object({ id: z.string().min(1).describe('ID del comentario') }),
      annotations: DESTRUCTIVE,
    },
    write(async (ws, args: { id: string }) => {
      const comment = findComment(ws.model, args.id);
      return apply(ws, { type: 'comment.remove', id: comment.id }, `Comentario ${comment.id} eliminado`, { id: comment.id });
    }),
  );

  // ----- Workspace ----------------------------------------------------------------------------

  server.registerTool(
    'update_workspace',
    {
      title: 'Modificar workspace',
      description: 'Cambia nombre, descripción, organización, arquitecto o lienzo por defecto del workspace. null borra el campo.',
      inputSchema: z.object({
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        organization: z.string().nullable().optional(),
        architect: z.string().nullable().optional(),
        defaultView: z.string().nullable().optional(),
      }),
      annotations: WRITE,
    },
    write(async (ws, args: Record<string, string | null | undefined>) => {
      const p: WorkspacePatch = {};
      for (const [key, value] of Object.entries(args)) if (value !== undefined) (p as Record<string, unknown>)[key] = value;
      if (typeof p.defaultView === 'string') p.defaultView = ws.view(p.defaultView).id;
      return apply(ws, { type: 'workspace.update', patch: p }, 'Workspace actualizado');
    }),
  );
}

