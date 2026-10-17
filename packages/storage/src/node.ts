import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { WorkspaceStorage } from './index.ts';

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.aegon', 'dist']);

/** Carpeta del disco vía Node (CLI, servidor MCP y tests). */
export class NodeFsStorage implements WorkspaceStorage {
  readonly kind = 'folder' as const;
  constructor(readonly root: string) {}

  get label() {
    return this.root;
  }

  async list(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name)) await walk(full);
        } else if (/\.(ya?ml|md|svg|json|txt)$/i.test(entry.name) || entry.name === '.gitignore') {
          out.push(relative(this.root, full).split(sep).join('/'));
        }
      }
    };
    await walk(this.root);
    return out.sort();
  }

  async read(path: string): Promise<string | undefined> {
    try {
      return await readFile(join(this.root, path), 'utf8');
    } catch {
      return undefined;
    }
  }

  async write(path: string, content: string): Promise<void> {
    const full = join(this.root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  async remove(path: string): Promise<void> {
    await rm(join(this.root, path), { force: true });
  }
}
