import { parseDocument } from 'yaml';
import {
  Comment as CommentSchema,
  Element as ElementSchema,
  Flow as FlowSchema,
  Relation as RelationSchema,
  SCHEMA_VERSION,
  View as ViewSchema,
  WorkspaceMeta as WorkspaceSchema,
  validateModel,
  type Comment,
  type Diagnostic,
  type Element,
  type Flow,
  type Model,
  type Relation,
  type View,
  type WorkspaceMeta,
} from '@aegon/core';
import type { ZodType } from 'zod';
import { MANIFEST_PATH, classifyPath, normalizePath } from './paths.ts';

export interface ParseResult {
  model: Model;
  diagnostics: Diagnostic[];
}

function readYaml(path: string, text: string, diagnostics: Diagnostic[]): unknown {
  const doc = parseDocument(text, { prettyErrors: false, uniqueKeys: true });
  if (doc.errors.length) {
    for (const err of doc.errors) {
      diagnostics.push({ severity: 'error', code: 'yaml-syntax', message: err.message.split('\n')[0]!, file: path });
    }
    return undefined;
  }
  return doc.toJS();
}

function validate<T>(schema: ZodType<T>, value: unknown, path: string, diagnostics: Diagnostic[]): T | undefined {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    const where = issue.path.length ? `${issue.path.map(String).join('.')}: ` : '';
    diagnostics.push({ severity: 'error', code: 'schema', message: `${where}${issue.message}`, file: path });
  }
  return undefined;
}

/**
 * Archivos → modelo. Los archivos inválidos se reportan como diagnósticos y se omiten, para que
 * un error de tipeo en un YAML no impida abrir el resto del workspace.
 */
export function parseWorkspace(input: ReadonlyMap<string, string>, options: { validate?: boolean } = {}): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const files = new Map<string, string>();
  for (const [path, text] of input) files.set(normalizePath(path), text);

  let workspace: WorkspaceMeta | undefined;
  const manifestText = files.get(MANIFEST_PATH);
  if (manifestText === undefined) {
    diagnostics.push({ severity: 'error', code: 'missing-manifest', message: 'Falta aegon.yaml: no es un workspace de Aegon', file: MANIFEST_PATH });
  } else {
    const raw = readYaml(MANIFEST_PATH, manifestText, diagnostics) as Record<string, unknown> | undefined;
    if (raw && raw.schema !== SCHEMA_VERSION) {
      diagnostics.push({ severity: 'error', code: 'schema-version', message: `Versión de formato no soportada: ${String(raw.schema)} (se espera ${SCHEMA_VERSION})`, file: MANIFEST_PATH });
    } else if (raw) {
      workspace = validate(WorkspaceSchema, raw, MANIFEST_PATH, diagnostics);
    }
  }
  workspace ??= { schema: SCHEMA_VERSION, id: 'workspace', name: 'Workspace' };

  const elements: Record<string, Element> = {};
  const relations: Record<string, Relation> = {};
  const views: Record<string, View> = {};
  const flows: Record<string, Flow> = {};
  const comments: Record<string, Comment> = {};
  const passthrough: Record<string, string> = {};
  const sourceOf = new Map<string, string>();

  for (const path of [...files.keys()].sort()) {
    const kind = classifyPath(path);
    if (!kind || kind.type === 'manifest') continue;
    const text = files.get(path)!;
    if (kind.type === 'passthrough') {
      passthrough[path] = text;
      continue;
    }
    const raw = readYaml(path, text, diagnostics);
    if (raw === undefined) continue;
    const target = { element: elements, relation: relations, view: views, flow: flows, comment: comments }[kind.type];
    const schema = { element: ElementSchema, relation: RelationSchema, view: ViewSchema, flow: FlowSchema, comment: CommentSchema }[
      kind.type
    ] as ZodType<Element | Relation | View | Flow | Comment>;
    const value = validate(schema, raw, path, diagnostics);
    if (!value) continue;
    if (value.id !== kind.id) {
      diagnostics.push({ severity: 'warning', code: 'id-filename', message: `El id "${value.id}" no coincide con el nombre de archivo`, file: path });
    }
    if (target[value.id]) {
      diagnostics.push({ severity: 'error', code: 'duplicate-id', message: `ID duplicado "${value.id}" (también en ${sourceOf.get(`${kind.type}:${value.id}`)})`, file: path });
      continue;
    }
    sourceOf.set(`${kind.type}:${value.id}`, path);
    (target as Record<string, unknown>)[value.id] = value;
  }

  const model: Model = { workspace, elements, relations, views };
  if (Object.keys(flows).length) model.flows = flows;
  if (Object.keys(comments).length) model.comments = comments;
  if (Object.keys(passthrough).length) model.passthrough = passthrough;

  if (options.validate !== false) {
    for (const d of validateModel(model)) {
      if (d.severity === 'info') continue;
      const file = d.entity ? sourceOf.get(`${d.entity.type}:${d.entity.id}`) : undefined;
      diagnostics.push(file ? { ...d, file } : d);
    }
  }
  return { model, diagnostics };
}

export function isAegonWorkspace(files: ReadonlyMap<string, string>): boolean {
  return [...files.keys()].some((p) => normalizePath(p) === MANIFEST_PATH);
}
