import { emptyModel, type Model } from '@aegon/core';
import { parseWorkspace, planWrite, serializeWorkspace } from '@aegon/format-yaml';
import { GitError, RemoteMovedError, isAegonFile, type GitSync, type Prepared, type RepoStatus } from './types.ts';

export interface GitHubTarget {
  owner: string;
  repo: string;
  branch: string;
  /** Token personal (fine-grained) con permiso de "Contents: read and write". */
  token: string;
  /** Para GitHub Enterprise; por defecto https://api.github.com. */
  apiUrl?: string;
}

type Fetch = typeof fetch;

function decodeBase64(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** SHA-1 de un blob de git (`blob <bytes>\0<contenido>`): identifica archivos sin descargarlos. */
export async function gitBlobSha(content: string): Promise<string> {
  const body = new TextEncoder().encode(content);
  const header = new TextEncoder().encode(`blob ${body.length}\0`);
  const data = new Uint8Array(header.length + body.length);
  data.set(header);
  data.set(body, header.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Sincronización desde el navegador con la API de GitHub (Git Data API): lee el árbol de un
 * commit y publica commits nuevos sin backend propio. Los archivos que no son del modelo se
 * conservan tal cual (se parte del árbol del commit remoto).
 */
export class GitHubSync implements GitSync {
  readonly kind = 'github' as const;
  readonly target: GitHubTarget;
  private readonly fetchImpl: Fetch;
  private readonly api: string;

  constructor(target: GitHubTarget, fetchImpl: Fetch = (...args) => fetch(...args)) {
    this.target = target;
    this.fetchImpl = fetchImpl;
    this.api = (target.apiUrl ?? 'https://api.github.com').replace(/\/$/, '');
  }

  get label(): string {
    return `${this.target.owner}/${this.target.repo}@${this.target.branch}`;
  }

  private async call<T>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<{ status: number; data: T }> {
    const res = await this.fetchImpl(`${this.api}/repos/${this.target.owner}/${this.target.repo}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.target.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = (res.status === 204 ? null : await res.json().catch(() => null)) as T;
    if (!res.ok && !okStatuses.includes(res.status)) {
      const message = (data as { message?: string } | null)?.message ?? res.statusText;
      if (res.status === 401) throw new GitError('GitHub rechazó el token (401): revisá que siga vigente', 'auth', { code: 401, stdout: '', stderr: message });
      if (res.status === 403 || res.status === 404) throw new GitError(`Sin acceso a ${this.target.owner}/${this.target.repo} (${res.status}): ${message}`, 'access', { code: res.status, stdout: '', stderr: message });
      throw new GitError(`GitHub ${method} ${path}: ${res.status} ${message}`, 'github', { code: res.status, stdout: '', stderr: message });
    }
    return { status: res.status, data };
  }

  async headSha(): Promise<string | null> {
    const { status, data } = await this.call<{ object: { sha: string } }>('GET', `/git/ref/heads/${encodeURIComponent(this.target.branch)}`, undefined, [404, 409]);
    return status === 200 ? data.object.sha : null;
  }

  async status(): Promise<RepoStatus> {
    const head = await this.headSha();
    return { branch: this.target.branch, remote: 'github', label: this.label, head, ahead: 0, behind: 0 };
  }

  private async treeOf(commitSha: string): Promise<string> {
    const { data } = await this.call<{ tree: { sha: string } }>('GET', `/git/commits/${commitSha}`);
    return data.tree.sha;
  }

  /** Archivos de Aegon en un commit. Lo que ya está en `known` con el mismo hash no se descarga. */
  async readFiles(commitSha: string, known?: ReadonlyMap<string, string>): Promise<Map<string, string>> {
    const tree = await this.treeOf(commitSha);
    const { data } = await this.call<{ tree: { path: string; type: string; sha: string }[]; truncated: boolean }>('GET', `/git/trees/${tree}?recursive=1`);
    if (data.truncated) throw new GitError('El repo es demasiado grande para leerlo por la API de GitHub', 'truncated');
    const blobs = data.tree.filter((e) => e.type === 'blob' && isAegonFile(e.path));
    const contents = await pool(blobs, 8, async (b) => {
      const local = known?.get(b.path);
      if (local !== undefined && (await gitBlobSha(local)) === b.sha) return local;
      const { data: blob } = await this.call<{ content: string; encoding: string }>('GET', `/git/blobs/${b.sha}`);
      return blob.encoding === 'base64' ? decodeBase64(blob.content) : blob.content;
    });
    return new Map(blobs.map((b, i) => [b.path, contents[i]!.replace(/\r\n/g, '\n')]));
  }

  async prepare(local: { base: Model; synced: string | null; files?: ReadonlyMap<string, string> }): Promise<Prepared> {
    const theirsHead = await this.headSha();
    if (!theirsHead || theirsHead === local.synced) {
      return { upToDate: true, theirsHead, base: local.base, theirs: local.base, theirsFiles: new Map() };
    }
    const theirsFiles = await this.readFiles(theirsHead, local.files);
    const theirs = parseWorkspace(theirsFiles, { validate: false }).model;
    // La base es el último commit sincronizado; si nunca se sincronizó, se parte de vacío.
    const base = local.synced ? local.base : emptyModel(theirs.workspace.id, theirs.workspace.name);
    return { upToDate: false, theirsHead, base, theirs, theirsFiles };
  }

  /** La Git Data API no funciona en repos vacíos: el primer commit se crea con la Contents API. */
  private async bootstrap(): Promise<string> {
    const content = btoa('# Aegon\n');
    const { data } = await this.call<{ commit: { sha: string } }>('PUT', '/contents/.aegon-init', {
      message: 'Aegon: inicializar repositorio',
      content,
      branch: this.target.branch,
    });
    return data.commit.sha;
  }

  async publish(model: Model, message: string, prepared: Prepared, previousFiles: ReadonlyMap<string, string>): Promise<{ head: string | null; files: Map<string, string> }> {
    let parent = prepared.theirsHead;
    let bootstrapped = false;
    if (!parent) {
      parent = await this.bootstrap();
      bootstrapped = true;
    }
    const parentFiles = prepared.upToDate ? previousFiles : prepared.theirsFiles;
    const next = serializeWorkspace(model, { previous: parentFiles });
    const plan = planWrite(parentFiles, next);
    if (!plan.writes.size && !plan.deletes.length && !bootstrapped) return { head: parent, files: next };

    const entries = [
      ...[...plan.writes].map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })),
      ...plan.deletes.map((path) => ({ path, mode: '100644', type: 'blob', sha: null })),
      ...(bootstrapped ? [{ path: '.aegon-init', mode: '100644', type: 'blob', sha: null }] : []),
    ];
    const baseTree = await this.treeOf(parent);
    const { data: tree } = await this.call<{ sha: string }>('POST', '/git/trees', { base_tree: baseTree, tree: entries });
    const { data: commit } = await this.call<{ sha: string }>('POST', '/git/commits', { message, tree: tree.sha, parents: [parent] });
    const { status } = await this.call('PATCH', `/git/refs/heads/${this.target.branch}`, { sha: commit.sha, force: false }, [422]);
    if (status === 422) throw new RemoteMovedError();
    return { head: commit.sha, files: next };
  }

  async adopt(prepared: Prepared): Promise<{ head: string | null; files: Map<string, string> }> {
    return { head: prepared.theirsHead, files: prepared.theirsFiles };
  }
}
