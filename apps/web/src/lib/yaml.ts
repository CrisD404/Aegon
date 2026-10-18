import type { Model } from '@aegon/core';
import {
  parseWorkspace,
  serializeWorkspace,
  type ParseResult,
  type SerializeOptions,
} from '@aegon/format-yaml';

/**
 * Parseo y serialización de workspaces fuera del hilo principal. Con pocos archivos se hace en el
 * acto (el viaje al worker cuesta más que el trabajo); con muchos, en `yaml.worker.ts`, así abrir
 * o guardar un workspace grande no congela la interfaz.
 */

/** A partir de esta cantidad de archivos (o elementos) conviene el worker. */
const WORKER_THRESHOLD = 600;

export type YamlRequest =
  | { type: 'parse'; files: ReadonlyMap<string, string>; options?: { validate?: boolean } }
  | { type: 'serialize'; model: Model; options?: SerializeOptions };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./yaml.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error !== undefined) p.reject(new Error(e.data.error));
      else p.resolve(e.data.result);
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Falló el worker de YAML'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** Arranca el worker antes de necesitarlo (su carga se superpone con la lectura de archivos). */
export function prewarmYamlWorker() {
  if (typeof Worker !== 'undefined') ensureWorker();
}

function call<T>(request: YamlRequest): Promise<T> {
  ensureWorker();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker!.postMessage({ ...request, id });
  });
}

const useWorker = (size: number) => size >= WORKER_THRESHOLD && typeof Worker !== 'undefined';

export async function parseFiles(
  files: ReadonlyMap<string, string>,
  options?: { validate?: boolean },
): Promise<ParseResult> {
  if (!useWorker(files.size)) return parseWorkspace(files, options);
  try {
    return await call<ParseResult>({ type: 'parse', files, options });
  } catch {
    return parseWorkspace(files, options);
  }
}

export async function serializeModel(
  model: Model,
  options?: SerializeOptions,
): Promise<Map<string, string>> {
  const size = Object.keys(model.elements).length + Object.keys(model.relations).length;
  if (!useWorker(size)) return serializeWorkspace(model, options);
  try {
    return await call<Map<string, string>>({ type: 'serialize', model, options });
  } catch {
    return serializeWorkspace(model, options);
  }
}
