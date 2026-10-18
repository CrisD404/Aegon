import { Workspace } from '@aegon/cli/workspace';

/**
 * Workspace del servidor MCP. Cada herramienta vuelve a leer la carpeta antes de actuar (así ve
 * lo que cambió la app, un editor o git) y las llamadas se serializan: leer → aplicar → escribir
 * es atómico aunque el cliente mande varias herramientas en paralelo.
 */
export class Session {
  readonly root: string;
  private ws: Workspace | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(root: string) {
    this.root = root;
  }

  run<T>(fn: (ws: Workspace) => Promise<T> | T): Promise<T> {
    const task = async () => {
      if (this.ws) await this.ws.reload();
      else this.ws = await Workspace.open(this.root, { searchUp: false });
      return fn(this.ws);
    };
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
