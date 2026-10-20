import type { WorkspaceStorage } from '@aegon/storage';

/**
 * Carpeta del disco servida por el servidor de desarrollo (`dev/fs-plugin.ts`). Solo existe con
 * `vite dev`: permite abrir en el navegador el mismo workspace que edita el MCP o la CLI.
 */
export class DevFolderStorage implements WorkspaceStorage {
  readonly kind = 'folder' as const;
  constructor(readonly root: string) {}

  get label() {
    return this.root.split(/[\\/]/).filter(Boolean).pop() ?? this.root;
  }

  async readAll(): Promise<Map<string, string>> {
    const res = await fetch(`/__aegon/fs?root=${encodeURIComponent(this.root)}`);
    const body = (await res.json()) as { files?: Record<string, string>; error?: string };
    if (!res.ok || !body.files) throw new Error(body.error ?? `No se pudo leer ${this.root}`);
    return new Map(Object.entries(body.files));
  }

  async list() {
    return [...(await this.readAll()).keys()];
  }

  async read(path: string) {
    return (await this.readAll()).get(path);
  }

  write(path: string, content: string) {
    return this.writeMany(new Map([[path, content]]), []);
  }

  remove(path: string) {
    return this.writeMany(new Map(), [path]);
  }

  async writeMany(writes: ReadonlyMap<string, string>, deletes: readonly string[]) {
    const res = await fetch('/__aegon/fs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: this.root, writes: [...writes], deletes: [...deletes] }),
    });
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'No se pudo escribir');
  }
}
