import { parseDocument } from 'yaml';
import {
  DEFAULT_SIZE,
  GROUP_PROVIDERS,
  RISKS,
  SCHEMA_VERSION,
  findBroker,
  findEngine,
  findTechnology,
  slugify,
  Element as ElementSchema,
  type Diagnostic,
  type EdgeShape,
  type Element,
  type GroupProvider,
  type Id,
  type Model,
  type NodeLayout,
  type Relation,
  type Risk,
  type Status,
  type View,
} from '@aegon/core';
import { normalizePath } from './paths.ts';

/**
 * Importa un repo generado por C4Pro (la versión anterior de Aegon) al formato v2.
 *
 * - `type: app` → `container`; `groupKind` → `group.provider`; tag `risk:x` → `risk`.
 * - `diagrams` → `views` (`layout[]` → `nodes{}`, `scopeElementId` → `scope`).
 * - `connections` → `relations` (la forma de la línea pasa al estilo del edge en cada vista).
 * - `parent` se infiere del scope de las vistas L2/L3; la membresía a grupos, de la contención
 *   visual en cada diagrama.
 * - FinOps, costos y ambientes se conservan en `extensions.c4pro`. `attachments/` se copia tal cual.
 */

type Raw = Record<string, unknown>;

const STATUS_MAP: Record<string, Status> = {
  live: 'live',
  future: 'planned',
  planned: 'planned',
  deprecated: 'deprecated',
  retired: 'retired',
  removed: 'retired',
};

const C4PRO_EXTENSION_KEYS = [
  'cost',
  'costByEnv',
  'volumeByEnv',
  'finopsTags',
  'actorVolume',
  'enabledEnvironments',
] as const;

function readRaw(path: string, text: string, diagnostics: Diagnostic[]): Raw | undefined {
  const doc = parseDocument(text, { prettyErrors: false });
  if (doc.errors.length) {
    diagnostics.push({ severity: 'error', code: 'yaml-syntax', message: doc.errors[0]!.message.split('\n')[0]!, file: path });
    return undefined;
  }
  const value = doc.toJS();
  return value && typeof value === 'object' ? (value as Raw) : undefined;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

export function isC4ProWorkspace(files: ReadonlyMap<string, string>): boolean {
  const paths = [...files.keys()].map(normalizePath);
  return paths.includes('.c4pro/manifest.yaml') || (paths.includes('workspace.yaml') && paths.some((p) => p.startsWith('elements/')));
}

function mapTechnology(value: unknown): string[] | undefined {
  const raw = str(value);
  if (!raw) return undefined;
  return raw
    .split(/[,/]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => findTechnology(t)?.id ?? findTechnology(slugify(t))?.id ?? t);
}

function convertElement(raw: Raw, path: string, diagnostics: Diagnostic[]): Element | undefined {
  const id = str(raw.id);
  if (!id) {
    diagnostics.push({ severity: 'error', code: 'c4pro-missing-id', message: 'Elemento sin id', file: path });
    return undefined;
  }
  const type = String(raw.type ?? 'system');
  const out: Record<string, unknown> = { id, name: str(raw.name) ?? id };

  const technology = mapTechnology(raw.technology);
  const description = str(raw.displayDescription) ?? str(raw.description);
  const docs = str(raw.detailedDescription);
  if (description) out.description = description;
  if (docs) out.docs = docs;
  if (raw.scope === 'external' || raw.scope === 'internal') out.scope = raw.scope === 'internal' ? undefined : 'external';
  const status = STATUS_MAP[String(raw.status ?? 'live')];
  if (status && status !== 'live') out.status = status;

  const tags: string[] = [];
  let risk: Risk | undefined;
  for (const tag of Array.isArray(raw.tags) ? raw.tags : []) {
    const t = String(tag);
    const match = /^risk:(\w+)$/.exec(t);
    if (match && (RISKS as readonly string[]).includes(match[1]!)) risk = match[1] as Risk;
    else tags.push(t);
  }
  if (tags.length) out.tags = tags;

  if (Array.isArray(raw.links)) {
    const links = raw.links
      .map((l) => (typeof l === 'string' ? { url: l } : l && typeof l === 'object' ? { url: str((l as Raw).url), label: str((l as Raw).label ?? (l as Raw).title) } : null))
      .filter((l): l is { url: string; label?: string } => !!l?.url)
      .map((l) => (l.label ? l : { url: l.url }));
    if (links.length) out.links = links;
  }

  const ext: Record<string, unknown> = {};
  for (const key of C4PRO_EXTENSION_KEYS) if (!isEmpty(raw[key])) ext[key] = raw[key];

  switch (type) {
    case 'actor':
      out.kind = 'actor';
      break;
    case 'group': {
      out.kind = 'group';
      const candidate = String(raw.groupKind ?? raw.technology ?? 'other');
      const provider: GroupProvider = (GROUP_PROVIDERS as readonly string[]).includes(candidate) ? (candidate as GroupProvider) : 'other';
      out.group = { provider };
      break;
    }
    case 'store':
    case 'db':
    case 'database':
    case 'datastore': {
      out.kind = 'store';
      const engineId = technology?.[0];
      const engine = engineId ? findEngine(engineId) : undefined;
      out.store = engine ? { engine: engine.id, type: engine.type } : { engine: 'other', ...(engineId ? { customEngine: engineId } : {}) };
      if (risk) out.risk = risk;
      break;
    }
    case 'queue':
    case 'bus':
    case 'topic': {
      out.kind = 'bus';
      const brokerId = technology?.[0];
      const broker = brokerId ? findBroker(brokerId) : undefined;
      out.bus = broker ? { broker: broker.id, type: broker.type } : { broker: 'other', ...(brokerId ? { customBroker: brokerId } : {}) };
      if (risk) out.risk = risk;
      break;
    }
    case 'system':
    case 'app':
    case 'container':
    case 'component':
    default: {
      out.kind = type === 'app' ? 'container' : type === 'container' || type === 'component' ? type : 'system';
      if (!['system', 'app', 'container', 'component'].includes(type)) {
        ext.originalType = type;
        diagnostics.push({ severity: 'warning', code: 'c4pro-unknown-type', message: `Tipo desconocido "${type}", se importó como sistema`, file: path });
      }
      if (technology) out.technology = technology;
      if (risk) out.risk = risk;
    }
  }
  if (out.kind === 'actor' || out.kind === 'group') {
    if (risk) tags.push(`risk:${risk}`);
    if (tags.length) out.tags = tags;
    if (out.kind === 'actor' && technology) ext.technology = raw.technology;
  }
  if (Object.keys(ext).length) out.extensions = { c4pro: ext };
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];

  const parsed = ElementSchema.safeParse(out);
  if (!parsed.success) {
    diagnostics.push({ severity: 'error', code: 'c4pro-invalid', message: parsed.error.issues[0]?.message ?? 'Elemento inválido', file: path });
    return undefined;
  }
  return parsed.data;
}

interface RawLayout {
  elementId: Id;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

function rectOf(l: RawLayout, el: Element) {
  const w = l.width ?? DEFAULT_SIZE[el.kind].w;
  const h = l.height ?? DEFAULT_SIZE[el.kind].h;
  return { x: l.x, y: l.y, w, h, cx: l.x + w / 2, cy: l.y + h / 2 };
}

export function importC4Pro(input: ReadonlyMap<string, string>): { model: Model; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const files = new Map<string, string>();
  for (const [path, text] of input) files.set(normalizePath(path), text);

  const manifest = files.has('.c4pro/manifest.yaml') ? readRaw('.c4pro/manifest.yaml', files.get('.c4pro/manifest.yaml')!, diagnostics) : undefined;
  const wsRaw = files.has('workspace.yaml') ? readRaw('workspace.yaml', files.get('workspace.yaml')!, diagnostics) ?? {} : {};
  const wsExt: Record<string, unknown> = {};
  for (const key of ['solutionName', 'environments', 'version', 'workspaceUuid']) if (!isEmpty(wsRaw[key])) wsExt[key] = wsRaw[key];
  if (manifest?.appVersion) wsExt.appVersion = manifest.appVersion;

  const name = str(wsRaw.name) ?? 'Workspace C4Pro';
  const workspace: Model['workspace'] = { schema: SCHEMA_VERSION, id: slugify(str(wsRaw.id) ?? name, 'workspace'), name };
  if (str(wsRaw.description)) workspace.description = str(wsRaw.description)!;
  if (str(wsRaw.companyName)) workspace.organization = str(wsRaw.companyName)!;
  if (str(wsRaw.architect)) workspace.architect = str(wsRaw.architect)!;
  if (Object.keys(wsExt).length) workspace.extensions = { c4pro: wsExt };

  const elements: Record<Id, Element> = {};
  const relations: Record<Id, Relation> = {};
  const views: Record<Id, View> = {};
  const passthrough: Record<string, string> = {};
  const rawConnections: Raw[] = [];
  const rawDiagrams: { path: string; raw: Raw }[] = [];

  for (const path of [...files.keys()].sort()) {
    const text = files.get(path)!;
    if (path.startsWith('attachments/') || path === 'workspace-logo.svg') {
      passthrough[path === 'workspace-logo.svg' ? 'attachments/workspace-logo.svg' : path] = text;
      continue;
    }
    if (!path.endsWith('.yaml') && !path.endsWith('.yml')) continue;
    if (path.startsWith('elements/')) {
      const raw = readRaw(path, text, diagnostics);
      const el = raw && convertElement(raw, path, diagnostics);
      if (el) elements[el.id] = el;
    } else if (path.startsWith('connections/')) {
      const raw = readRaw(path, text, diagnostics);
      if (raw) rawConnections.push({ ...raw, __path: path });
    } else if (path.startsWith('diagrams/')) {
      const raw = readRaw(path, text, diagnostics);
      if (raw) rawDiagrams.push({ path, raw });
    }
  }

  // Vistas + inferencia de jerarquía y grupos.
  const shapeByConnection = new Map<Id, EdgeShape>();
  for (const { path, raw } of rawDiagrams) {
    const id = str(raw.id);
    if (!id) continue;
    const level = [1, 2, 3].includes(Number(raw.level)) ? (Number(raw.level) as 1 | 2 | 3) : 1;
    const scope = str(raw.scopeElementId);
    const layout = (Array.isArray(raw.layout) ? raw.layout : []) as RawLayout[];
    const nodes: Record<Id, NodeLayout> = {};
    for (const l of layout) {
      const el = elements[l.elementId];
      if (!el) {
        diagnostics.push({ severity: 'warning', code: 'c4pro-missing-node', message: `El diagrama "${String(raw.name)}" ubica "${l.elementId}", que no existe`, file: path });
        continue;
      }
      if (l.elementId === scope) continue;
      const node: NodeLayout = { x: Number(l.x) || 0, y: Number(l.y) || 0 };
      if (l.width) node.w = Number(l.width);
      if (l.height) node.h = Number(l.height);
      nodes[l.elementId] = node;

      if (scope && elements[scope] && !el.parent) {
        const scopeKind = elements[scope]!.kind;
        if (level === 2 && scopeKind === 'system' && (el.kind === 'container' || el.kind === 'store')) el.parent = scope;
        if (level === 3 && scopeKind === 'container' && el.kind === 'component') el.parent = scope;
      }
    }
    const view: View = { id, name: str(raw.name) ?? id, level, nodes };
    if (scope && elements[scope]) view.scope = scope;
    else if (level > 1) {
      diagnostics.push({ severity: 'warning', code: 'c4pro-missing-scope', message: `El diagrama "${view.name}" no tiene un elemento abierto válido`, file: path });
    }
    views[id] = view;

    // Grupos: un elemento pertenece al grupo más chico cuyo rectángulo contiene su centro.
    const groupRects = layout
      .filter((l) => elements[l.elementId]?.kind === 'group')
      .map((l) => ({ id: l.elementId, ...rectOf(l, elements[l.elementId]!) }))
      .sort((a, b) => a.w * a.h - b.w * b.h);
    for (const l of layout) {
      const el = elements[l.elementId];
      if (!el || l.elementId === scope) continue;
      const r = rectOf(l, el);
      const container = groupRects.find(
        (g) => g.id !== el.id && r.cx >= g.x && r.cx <= g.x + g.w && r.cy >= g.y && r.cy <= g.y + g.h && (el.kind !== 'group' || g.w * g.h > r.w * r.h),
      );
      if (!container) continue;
      if (el.kind === 'group') {
        if (!el.parent) el.parent = container.id;
      } else if (!el.groups?.includes(container.id)) {
        el.groups = [...(el.groups ?? []), container.id];
      }
    }
  }

  const pairs = new Map<string, Relation>();
  for (const raw of rawConnections) {
    const path = String(raw.__path);
    const id = str(raw.id);
    const from = str(raw.sourceId);
    const to = str(raw.targetId);
    if (!id || !from || !to) continue;
    if (!elements[from] || !elements[to]) {
      diagnostics.push({ severity: 'warning', code: 'c4pro-dangling-connection', message: `La conexión "${id}" apunta a un elemento que no existe`, file: path });
      continue;
    }
    if (elements[from]!.kind === 'group' || elements[to]!.kind === 'group' || from === to) continue;
    // En C4 hay una relación por par: una repetida se descarta y una inversa la vuelve bidireccional.
    const pair = [from, to].sort().join('|');
    const existing = pairs.get(pair);
    if (existing) {
      if (existing.from !== from) existing.direction = 'bidirectional';
      diagnostics.push({ severity: 'info', code: 'c4pro-duplicate-connection', message: `La conexión "${id}" repite "${existing.id}" y se fusionó`, file: path });
      continue;
    }
    const rel: Relation = { id, from, to };
    pairs.set(pair, rel);
    if (str(raw.label)) rel.label = str(raw.label)!;
    if (raw.direction === 'bidirectional') rel.direction = 'bidirectional';
    const status = STATUS_MAP[String(raw.status ?? 'live')];
    if (status && status !== 'live') rel.status = status;
    relations[id] = rel;
    const shape = String(raw.shape ?? 'curved');
    const mapped: EdgeShape = shape === 'straight' ? 'straight' : shape === 'step' || shape === 'orthogonal' || shape === 'smoothstep' ? 'step' : 'curved';
    if (mapped !== 'curved') shapeByConnection.set(id, mapped);
  }
  for (const view of Object.values(views)) {
    for (const [relId, shape] of shapeByConnection) {
      const rel = relations[relId]!;
      if (view.nodes[rel.from] && view.nodes[rel.to]) view.edges = { ...(view.edges ?? {}), [relId]: { shape } };
    }
  }

  // Grupos anidados que quedaron apuntando a sí mismos o en ciclo.
  for (const el of Object.values(elements)) {
    if (el.groups) el.groups = el.groups.filter((g) => g !== el.id);
    if (el.groups && !el.groups.length) delete el.groups;
  }

  if (views['root-landscape']) workspace.defaultView = 'root-landscape';
  else {
    const firstL1 = Object.values(views).filter((v) => v.level === 1).sort((a, b) => a.id.localeCompare(b.id))[0];
    if (firstL1) workspace.defaultView = firstL1.id;
  }

  const model: Model = { workspace, elements, relations, views };
  if (Object.keys(passthrough).length) model.passthrough = passthrough;
  return { model, diagnostics };
}
