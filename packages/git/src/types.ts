import type { Model } from '@aegon/core';
import { AGENTS_PATH, GITIGNORE_PATH, classifyPath } from '@aegon/format-yaml';

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Ejecuta el `git` del sistema en la carpeta del workspace (Node en CLI/tests, Rust en Tauri). */
export interface GitBackend {
  run(args: string[], opts?: { input?: string }): Promise<GitResult>;
}

export class GitError extends Error {
  readonly code: string;
  readonly result?: GitResult;
  constructor(message: string, code = 'git', result?: GitResult) {
    super(message);
    this.name = 'GitError';
    this.code = code;
    this.result = result;
  }
}

/** El remoto avanzó entre que se leyó y se publicó: hay que volver a sincronizar. */
export class RemoteMovedError extends GitError {
  constructor() {
    super('El remoto cambió mientras se publicaba: volvé a intentar para combinar los cambios.', 'remote-moved');
  }
}

export interface RepoStatus {
  branch: string | null;
  remote: string | null;
  /** Texto para mostrar (`origin/main`, `github.com/org/repo@main`). */
  label: string;
  head: string | null;
  ahead: number;
  behind: number;
}

/** Resultado de traer el remoto: lo necesario para un merge de tres vías. */
export interface Prepared {
  /** El remoto no tiene nada que no tengamos. */
  upToDate: boolean;
  theirsHead: string | null;
  /** Modelo en el ancestro común. */
  base: Model;
  theirs: Model;
  theirsFiles: Map<string, string>;
}

/** Proveedor de sincronización (CLI de git o GitHub API). La app orquesta merge y conflictos. */
export interface GitSync {
  readonly kind: 'cli' | 'github';
  status(): Promise<RepoStatus>;
  /** `files`: copia local del commit sincronizado (permite no volver a descargar lo que no cambió). */
  prepare(local: { base: Model; synced: string | null; files?: ReadonlyMap<string, string> }): Promise<Prepared>;
  /** Publica el modelo (ya combinado con el remoto) como commit y lo sube. */
  publish(model: Model, message: string, prepared: Prepared, previousFiles: ReadonlyMap<string, string>): Promise<{ head: string | null; files: Map<string, string> }>;
  /** Pull: la copia local pasa a ser la del remoto (el borrador combinado queda en la app). */
  adopt(prepared: Prepared): Promise<{ head: string | null; files: Map<string, string> }>;
}

/** Archivos que Aegon administra dentro del repo (el resto lo maneja git normalmente). */
export function isAegonFile(path: string): boolean {
  return classifyPath(path) !== null || path === AGENTS_PATH || path === GITIGNORE_PATH || path === '.gitattributes';
}

export const AEGON_PATHSPECS = ['aegon.yaml', 'AGENTS.md', '.gitignore', '.gitattributes', 'model', 'views', 'attachments'] as const;
