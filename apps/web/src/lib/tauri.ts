import type { GitBackend, GitResult } from '@aegon/git';
import type { WorkspaceStorage } from '@aegon/storage';

/**
 * Puente con la app de escritorio (Tauri 2). En el navegador nada de esto se usa: la app detecta
 * Tauri y, si está, lee/escribe el disco y ejecuta git a través de comandos de Rust.
 */

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/** Carpeta del disco vía comandos de Rust (lectura y escritura en bloque). */
export class TauriStorage implements WorkspaceStorage {
  readonly kind = 'folder' as const;
  constructor(readonly root: string) {}

  get label() {
    return this.root.split(/[\\/]/).filter(Boolean).pop() ?? this.root;
  }
  list() {
    return invoke<string[]>('fs_list', { root: this.root });
  }
  async read(path: string) {
    return (await invoke<string | null>('fs_read', { root: this.root, path })) ?? undefined;
  }
  write(path: string, content: string) {
    return invoke<void>('fs_write_many', { root: this.root, writes: [[path, content]], deletes: [] });
  }
  remove(path: string) {
    return invoke<void>('fs_write_many', { root: this.root, writes: [], deletes: [path] });
  }
  async readAll() {
    return new Map(Object.entries(await invoke<Record<string, string>>('fs_read_all', { root: this.root })));
  }
  writeMany(writes: ReadonlyMap<string, string>, deletes: readonly string[]) {
    return invoke<void>('fs_write_many', { root: this.root, writes: [...writes], deletes: [...deletes] });
  }
}

/** `git` del sistema ejecutado desde Rust en la carpeta del workspace. */
export class TauriGitBackend implements GitBackend {
  constructor(readonly cwd: string) {}
  run(args: string[], opts: { input?: string } = {}): Promise<GitResult> {
    return invoke<GitResult>('git_run', { cwd: this.cwd, args, input: opts.input ?? null });
  }
}

export async function pickFolderNative(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({ directory: true, multiple: false, title: 'Elegí la carpeta del workspace' });
  return typeof result === 'string' ? result : null;
}

/** Observa la carpeta (cambios externos: editor, agente de IA, git) y avisa con las rutas. */
export async function watchFolder(root: string, onChange: (paths: string[]) => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  await invoke<void>('watch_start', { root });
  const unlisten = await listen<{ root: string; paths: string[] }>('aegon://fs-changed', (event) => {
    if (event.payload.root === root) onChange(event.payload.paths);
  });
  return () => {
    unlisten();
    void invoke<void>('watch_stop', { root });
  };
}
