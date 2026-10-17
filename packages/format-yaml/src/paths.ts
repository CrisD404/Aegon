import type { Id } from '@aegon/core';

/** Convenciones de rutas del formato Aegon v2 (siempre POSIX y relativas a la raíz del repo). */
export const MANIFEST_PATH = 'aegon.yaml';
export const AGENTS_PATH = 'AGENTS.md';
export const GITIGNORE_PATH = '.gitignore';
export const GITATTRIBUTES_PATH = '.gitattributes';
export const ELEMENTS_DIR = 'model/elements/';
export const RELATIONS_DIR = 'model/relations/';
export const VIEWS_DIR = 'views/';
export const ATTACHMENTS_DIR = 'attachments/';

export const elementPath = (id: Id) => `${ELEMENTS_DIR}${id}.yaml`;
export const relationPath = (id: Id) => `${RELATIONS_DIR}${id}.yaml`;
export const viewPath = (id: Id) => `${VIEWS_DIR}${id}.yaml`;

export type EntityFile =
  | { type: 'manifest' }
  | { type: 'element' | 'relation' | 'view'; id: Id }
  | { type: 'passthrough' };

function idFromFile(path: string, dir: string): Id | null {
  if (!path.startsWith(dir)) return null;
  const rest = path.slice(dir.length);
  if (rest.includes('/') || !/\.ya?ml$/.test(rest)) return null;
  return rest.replace(/\.ya?ml$/, '');
}

/** Clasifica una ruta. `null` = archivo que Aegon no administra (README, código, etc.). */
export function classifyPath(path: string): EntityFile | null {
  if (path === MANIFEST_PATH) return { type: 'manifest' };
  const el = idFromFile(path, ELEMENTS_DIR);
  if (el) return { type: 'element', id: el };
  const rel = idFromFile(path, RELATIONS_DIR);
  if (rel) return { type: 'relation', id: rel };
  const view = idFromFile(path, VIEWS_DIR);
  if (view) return { type: 'view', id: view };
  if (path.startsWith(ATTACHMENTS_DIR)) return { type: 'passthrough' };
  return null;
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}
