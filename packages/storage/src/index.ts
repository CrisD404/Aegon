import { clear, createStore, del, delMany, entries, get, keys, set, setMany, type UseStore } from 'idb-keyval';

/**
 * Almacenamiento de los archivos de un workspace. Las rutas son POSIX y relativas a la raíz.
 * Implementaciones: memoria (tests), IndexedDB (workspaces del navegador) y carpeta local
 * (File System Access API). En la Fase 2 se suman Tauri (fs nativo) y Node (CLI/MCP).
 */
export interface WorkspaceStorage {
  readonly kind: 'memory' | 'idb' | 'folder';
  /** Texto para mostrar (nombre de carpeta, "Navegador"…). */
  readonly label: string;
  list(): Promise<string[]>;
  read(path: string): Promise<string | undefined>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Lectura en bloque (opcional): mucho más rápida que `read` archivo por archivo. */
  readAll?(): Promise<Map<string, string>>;
  /** Escritura en bloque (opcional). */
  writeMany?(writes: ReadonlyMap<string, string>, deletes: readonly string[]): Promise<void>;
}

export async function readAll(storage: WorkspaceStorage): Promise<Map<string, string>> {
  if (storage.readAll) return sortByPath(await storage.readAll());
  const out = new Map<string, string>();
  const paths = await storage.list();
  await Promise.all(
    paths.map(async (p) => {
      const text = await storage.read(p);
      if (text !== undefined) out.set(p, text);
    }),
  );
  return sortByPath(out);
}

function sortByPath(files: Map<string, string>): Map<string, string> {
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export async function applyWritePlan(
  storage: WorkspaceStorage,
  plan: { writes: ReadonlyMap<string, string>; deletes: readonly string[] },
): Promise<void> {
  if (storage.writeMany) return storage.writeMany(plan.writes, plan.deletes);
  for (const [path, content] of plan.writes) await storage.write(path, content);
  for (const path of plan.deletes) await storage.remove(path);
}

// ---------------------------------------------------------------------------------------------

export class MemoryStorage implements WorkspaceStorage {
  readonly kind = 'memory' as const;
  readonly label: string;
  readonly files: Map<string, string>;

  constructor(initial?: Iterable<[string, string]>, label = 'Memoria') {
    this.files = new Map(initial);
    this.label = label;
  }
  async list() {
    return [...this.files.keys()].sort();
  }
  async read(path: string) {
    return this.files.get(path);
  }
  async write(path: string, content: string) {
    this.files.set(path, content);
  }
  async remove(path: string) {
    this.files.delete(path);
  }
}

// ---------------------------------------------------------------------------------------------

/**
 * Archivos de un workspace guardados en IndexedDB. Cada workspace tiene su propia base
 * (`aegon-ws-<clave>`), así se lee todo en una sola transacción y borrarlo es eliminar la base.
 */
export class IdbStorage implements WorkspaceStorage {
  readonly kind = 'idb' as const;
  readonly label = 'Navegador';
  private readonly dbName: string;
  private store: UseStore | undefined;

  constructor(readonly workspaceKey: string) {
    this.dbName = `aegon-ws-${workspaceKey}`;
  }
  private db() {
    return (this.store ??= createStore(this.dbName, 'files'));
  }
  async list() {
    return ((await keys(this.db())) as string[]).sort();
  }
  async read(path: string) {
    return get<string>(path, this.db());
  }
  async readAll() {
    return new Map((await entries<string, string>(this.db())).map(([k, v]) => [String(k), v]));
  }
  async write(path: string, content: string) {
    await set(path, content, this.db());
  }
  async remove(path: string) {
    await del(path, this.db());
  }
  async writeMany(writes: ReadonlyMap<string, string>, deletes: readonly string[]) {
    if (writes.size) await setMany([...writes], this.db());
    if (deletes.length) await delMany([...deletes], this.db());
  }
  /** Reemplaza todos los archivos del workspace en una sola transacción. */
  async replaceAll(files: ReadonlyMap<string, string>) {
    await clear(this.db());
    await setMany([...files], this.db());
  }
  async destroy() {
    await clear(this.db());
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(this.dbName);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  }
}

// ---------------------------------------------------------------------------------------------

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.aegon', 'dist', '.idea', '.vscode']);

export function isFsAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

interface DirectoryPickerWindow {
  showDirectoryPicker(options?: { mode?: 'read' | 'readwrite'; id?: string }): Promise<FileSystemDirectoryHandle>;
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  return (window as unknown as DirectoryPickerWindow).showDirectoryPicker({ mode: 'readwrite', id: 'aegon-workspace' });
}

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission(d: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(d: { mode: 'readwrite' }): Promise<PermissionState>;
};

/** Verifica (y si `request`, pide) permiso de escritura sobre la carpeta. Pedir requiere un gesto del usuario. */
export async function ensureDirectoryPermission(handle: FileSystemDirectoryHandle, request: boolean): Promise<boolean> {
  const h = handle as PermissionHandle;
  if (typeof h.queryPermission !== 'function') return true;
  if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  if (!request) return false;
  return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Carpeta local elegida por el usuario (Chromium/Edge; WebView2 en Windows también la soporta). */
export class FolderStorage implements WorkspaceStorage {
  readonly kind = 'folder' as const;
  constructor(readonly handle: FileSystemDirectoryHandle) {}

  get label() {
    return this.handle.name;
  }

  async list() {
    const out: string[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, entry] of dir.entries()) {
        if (entry.kind === 'directory') {
          if (!IGNORED_DIRS.has(name)) await walk(entry as FileSystemDirectoryHandle, `${prefix}${name}/`);
        } else if (/\.(ya?ml|md|svg|json|txt)$/i.test(name) || name === '.gitignore') {
          out.push(`${prefix}${name}`);
        }
      }
    };
    await walk(this.handle, '');
    return out.sort();
  }

  private async dirFor(path: string, create: boolean): Promise<{ dir: FileSystemDirectoryHandle; name: string } | undefined> {
    const parts = path.split('/');
    const name = parts.pop()!;
    let dir = this.handle;
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part, { create });
      } catch {
        return undefined;
      }
    }
    return { dir, name };
  }

  async read(path: string) {
    const target = await this.dirFor(path, false);
    if (!target) return undefined;
    try {
      const file = await (await target.dir.getFileHandle(target.name)).getFile();
      return await file.text();
    } catch {
      return undefined;
    }
  }

  async write(path: string, content: string) {
    const target = await this.dirFor(path, true);
    if (!target) throw new Error(`No se pudo crear la carpeta para ${path}`);
    const fileHandle = await target.dir.getFileHandle(target.name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async remove(path: string) {
    const target = await this.dirFor(path, false);
    if (!target) return;
    try {
      await target.dir.removeEntry(target.name);
    } catch {
      // Ya no existía.
    }
  }
}
