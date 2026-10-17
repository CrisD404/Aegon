/**
 * GitHub en memoria (solo las rutas de la Git Data API que usa GitHubSync). Sirve para tests
 * unitarios y para los e2e del navegador sin red.
 */
interface Commit {
  tree: string;
  parents: string[];
  message: string;
}

export class FakeGitHub {
  readonly blobs = new Map<string, string>();
  readonly trees = new Map<string, Map<string, string>>(); // tree sha -> (path -> blob sha)
  readonly commits = new Map<string, Commit>();
  readonly refs = new Map<string, string>();
  private seq = 0;

  constructor(
    readonly owner = 'acme',
    readonly repo = 'arquitectura',
  ) {}

  private sha(prefix: string) {
    this.seq++;
    return `${prefix}${this.seq.toString(16).padStart(39 - prefix.length, '0')}`.padEnd(40, '0');
  }

  private blob(content: string): string {
    const sha = this.sha('b');
    this.blobs.set(sha, content);
    return sha;
  }

  /** Crea un commit con estos archivos (como si alguien hubiera hecho push desde otro lado). */
  pushFiles(branch: string, files: ReadonlyMap<string, string> | Record<string, string>, message = 'commit'): string {
    const entries = files instanceof Map ? [...files] : Object.entries(files);
    const parent = this.refs.get(branch);
    const base = parent ? new Map(this.trees.get(this.commits.get(parent)!.tree)) : new Map<string, string>();
    for (const [path, content] of entries) base.set(path, this.blob(content));
    const tree = this.sha('t');
    this.trees.set(tree, base);
    const commit = this.sha('c');
    this.commits.set(commit, { tree, parents: parent ? [parent] : [], message });
    this.refs.set(branch, commit);
    return commit;
  }

  filesAt(branch: string): Map<string, string> {
    const commit = this.commits.get(this.refs.get(branch)!)!;
    return new Map([...this.trees.get(commit.tree)!].map(([p, b]) => [p, this.blobs.get(b)!]));
  }

  /** Implementación de `fetch` para GitHubSync. */
  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const prefix = `/repos/${this.owner}/${this.repo}`;
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (!url.pathname.startsWith(prefix)) return json(404, { message: 'Not Found' });
    const path = url.pathname.slice(prefix.length);
    let m: RegExpMatchArray | null;

    if (method === 'GET' && (m = path.match(/^\/git\/ref\/heads\/(.+)$/))) {
      const sha = this.refs.get(decodeURIComponent(m[1]!));
      return sha ? json(200, { object: { sha } }) : json(404, { message: 'Not Found' });
    }
    if (method === 'GET' && (m = path.match(/^\/git\/commits\/(\w+)$/))) {
      const c = this.commits.get(m[1]!);
      return c ? json(200, { sha: m[1], tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })) }) : json(404, {});
    }
    if (method === 'GET' && (m = path.match(/^\/git\/trees\/(\w+)$/))) {
      const t = this.trees.get(m[1]!);
      if (!t) return json(404, {});
      return json(200, { sha: m[1], truncated: false, tree: [...t].map(([p, sha]) => ({ path: p, type: 'blob', sha, mode: '100644' })) });
    }
    if (method === 'GET' && (m = path.match(/^\/git\/blobs\/(\w+)$/))) {
      const content = this.blobs.get(m[1]!);
      if (content === undefined) return json(404, {});
      const bytes = new TextEncoder().encode(content);
      let bin = '';
      for (const byte of bytes) bin += String.fromCharCode(byte);
      return json(200, { sha: m[1], encoding: 'base64', content: btoa(bin) });
    }
    if (method === 'POST' && path === '/git/trees') {
      const tree = new Map(body.base_tree ? this.trees.get(body.base_tree) : []);
      for (const e of body.tree as { path: string; content?: string; sha?: string | null }[]) {
        if (e.sha === null) tree.delete(e.path);
        else if (e.content !== undefined) tree.set(e.path, this.blob(e.content));
        else if (e.sha) tree.set(e.path, e.sha);
      }
      const sha = this.sha('t');
      this.trees.set(sha, tree);
      return json(201, { sha });
    }
    if (method === 'POST' && path === '/git/commits') {
      const sha = this.sha('c');
      this.commits.set(sha, { tree: body.tree, parents: body.parents, message: body.message });
      return json(201, { sha });
    }
    if (method === 'PATCH' && (m = path.match(/^\/git\/refs\/heads\/(.+)$/))) {
      const branch = decodeURIComponent(m[1]!);
      const current = this.refs.get(branch);
      const parents = this.commits.get(body.sha)?.parents ?? [];
      if (!body.force && current && !parents.includes(current)) return json(422, { message: 'Update is not a fast forward' });
      this.refs.set(branch, body.sha);
      return json(200, { object: { sha: body.sha } });
    }
    if (method === 'PUT' && (m = path.match(/^\/contents\/(.+)$/))) {
      const bin = atob(body.content);
      const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
      const sha = this.pushFiles(body.branch ?? 'main', { [decodeURIComponent(m[1]!)]: new TextDecoder().decode(bytes) }, body.message);
      return json(201, { commit: { sha } });
    }
    if (method === 'POST' && path === '/git/refs') {
      const branch = String(body.ref).replace('refs/heads/', '');
      if (this.refs.has(branch)) return json(422, { message: 'Reference already exists' });
      this.refs.set(branch, body.sha);
      return json(201, { object: { sha: body.sha } });
    }
    return json(404, { message: `Ruta no soportada: ${method} ${path}` });
  };
}
