import { createStore, del, get, set, type UseStore } from 'idb-keyval';
import type { Model, Template } from '@aegon/core';

/**
 * Persistencia local de la app (IndexedDB): registro de workspaces, borradores y handles de
 * carpetas. Todo acceso está protegido: si IndexedDB no está disponible la app sigue andando,
 * solo que sin recordar nada entre sesiones.
 */

export interface GitHubLink {
  owner: string;
  repo: string;
  branch: string;
}

export interface WorkspaceRecord {
  /** Clave interna (no es el `id` del manifiesto). */
  key: string;
  name: string;
  /**
   * browser: IndexedDB · folder: carpeta vía File System Access (web) · desktop: carpeta del
   * disco en la app de escritorio (con git si es un repo) · github: copia local de un repo de GitHub ·
   * dev: carpeta del disco servida por `vite dev` (solo desarrollo).
   */
  source: 'browser' | 'folder' | 'desktop' | 'github' | 'dev';
  folderName?: string;
  /** Ruta absoluta (app de escritorio). */
  path?: string;
  github?: GitHubLink;
  /** Último commit sincronizado con el remoto (base de los merges). */
  synced?: string | null;
  openedAt: number;
}

let store: UseStore | undefined;
const db = () => (store ??= createStore('aegon-app', 'kv'));

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.warn('[aegon] IndexedDB no disponible:', error);
    return fallback;
  }
}

export const persist = {
  listWorkspaces: () => safe(async () => ((await get<WorkspaceRecord[]>('registry', db())) ?? []).sort((a, b) => b.openedAt - a.openedAt), []),
  async saveWorkspace(record: WorkspaceRecord) {
    await safe(async () => {
      const list = (await get<WorkspaceRecord[]>('registry', db())) ?? [];
      await set('registry', [record, ...list.filter((r) => r.key !== record.key)], db());
    }, undefined);
  },
  async removeWorkspace(key: string) {
    await safe(async () => {
      const list = (await get<WorkspaceRecord[]>('registry', db())) ?? [];
      await set('registry', list.filter((r) => r.key !== key), db());
      await del(`draft:${key}`, db());
      await del(`handle:${key}`, db());
      await del(`token:${key}`, db());
    }, undefined);
  },
  /** Biblioteca de templates del usuario (vale para todos los workspaces de este equipo). */
  listTemplates: () => safe(async () => (await get<Template[]>('templates', db())) ?? [], []),
  saveTemplates: (templates: Template[]) => safe(() => set('templates', templates, db()), undefined),
  getDraft: (key: string) => safe(() => get<Model>(`draft:${key}`, db()), undefined),
  setDraft: (key: string, model: Model) => safe(() => set(`draft:${key}`, model, db()), undefined),
  clearDraft: (key: string) => safe(() => del(`draft:${key}`, db()), undefined),
  getHandle: (key: string) => safe(() => get<FileSystemDirectoryHandle>(`handle:${key}`, db()), undefined),
  /** Token de GitHub: queda solo en este navegador (IndexedDB), nunca en el repo. */
  getToken: (key: string) => safe(() => get<string>(`token:${key}`, db()), undefined),
  setToken: (key: string, token: string) => safe(() => set(`token:${key}`, token, db()), undefined),
  setHandle: (key: string, handle: FileSystemDirectoryHandle) => safe(() => set(`handle:${key}`, handle, db()), undefined),
};

/** Preferencias livianas de la UI en localStorage (tema, grilla, paneles). */
export function loadPrefs<T extends object>(defaults: T): T {
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem('aegon.prefs') ?? '{}') as Partial<T>) };
  } catch {
    return defaults;
  }
}

export function savePrefs(prefs: object) {
  try {
    localStorage.setItem('aegon.prefs', JSON.stringify(prefs));
  } catch {
    // Modo privado o almacenamiento bloqueado: se ignora.
  }
}

export function lastWorkspaceKey(): string | null {
  try {
    return localStorage.getItem('aegon.lastWorkspace');
  } catch {
    return null;
  }
}

export function setLastWorkspaceKey(key: string) {
  try {
    localStorage.setItem('aegon.lastWorkspace', key);
  } catch {
    // ignorado
  }
}

export function newKey(): string {
  return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
