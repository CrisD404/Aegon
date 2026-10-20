import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Solo en desarrollo (`vite dev`): expone una carpeta del disco para abrir un workspace real en el
 * navegador con `?dev-folder=<ruta>` (la app de escritorio lo hace con Rust). Sirve para revisar
 * en el navegador lo que escribe el servidor MCP o la CLI. No existe en el build.
 */

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.aegon', 'dist', 'target']);
const TEXT_FILE = /\.(ya?ml|md|svg|json|txt)$/i;

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readAllFiles(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await walk(full);
      } else if (TEXT_FILE.test(entry.name) || entry.name === '.gitignore' || entry.name === '.gitattributes') {
        out[relative(root, full).split(sep).join('/')] = await readFile(full, 'utf8');
      }
    }
  };
  await walk(root);
  return out;
}

/** Ruta relativa segura dentro de la raíz (sin `..` ni rutas absolutas). */
function inside(root: string, rel: string): string {
  const full = normalize(join(root, rel));
  if (!rel || isAbsolute(rel) || relative(root, full).startsWith('..')) throw new Error(`Ruta inválida: ${rel}`);
  return full;
}

export function devFolderPlugin(): Plugin {
  return {
    name: 'aegon-dev-folder',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__aegon/fs', (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(body));
        };
        void (async () => {
          try {
            if (req.method === 'GET') {
              const root = new URL(req.url ?? '', 'http://x').searchParams.get('root') ?? '';
              if (!isAbsolute(root) || !(await isDir(root))) return send(404, { error: `No existe la carpeta ${root}` });
              return send(200, { files: await readAllFiles(root) });
            }
            if (req.method === 'POST') {
              const chunks: Buffer[] = [];
              for await (const chunk of req) chunks.push(chunk as Buffer);
              const { root, writes, deletes } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { root: string; writes: [string, string][]; deletes: string[] };
              if (!isAbsolute(root) || !(await isDir(root))) return send(404, { error: `No existe la carpeta ${root}` });
              for (const [rel, content] of writes) {
                const full = inside(root, rel);
                await mkdir(dirname(full), { recursive: true });
                await writeFile(full, content, 'utf8');
              }
              for (const rel of deletes) await rm(inside(root, rel), { force: true });
              return send(200, { ok: true });
            }
            send(405, { error: 'Método no soportado' });
          } catch (error) {
            send(500, { error: (error as Error).message });
          }
        })();
      });
    },
  };
}
