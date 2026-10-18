import { emptyModel, type Model } from '@aegon/core';
import { parseWorkspace, planWrite, serializeWorkspace } from '@aegon/format-yaml';
import { applyWritePlan, readAll, type WorkspaceStorage } from '@aegon/storage';
import {
  AEGON_PATHSPECS,
  GitError,
  RemoteMovedError,
  isAegonFile,
  type GitBackend,
  type GitResult,
  type GitSync,
  type Prepared,
  type RepoStatus,
} from './types.ts';

/**
 * Sincronización con el `git` del sistema (escritorio y CLI). Usa las credenciales y la
 * configuración del usuario. Los archivos del modelo se combinan con el merge semántico de Aegon;
 * el resto del repo (README, código) lo combina git normalmente.
 */
export class CliGitSync implements GitSync {
  readonly kind = 'cli' as const;
  private readonly git: GitBackend;
  private readonly storage: WorkspaceStorage;

  constructor(git: GitBackend, storage: WorkspaceStorage) {
    this.git = git;
    this.storage = storage;
  }

  private async run(args: string[], opts: { input?: string; allowFail?: boolean } = {}): Promise<GitResult> {
    const result = await this.git.run(args, opts.input !== undefined ? { input: opts.input } : {});
    if (result.code !== 0 && !opts.allowFail) {
      const detail = (result.stderr || result.stdout).trim().split('\n').slice(-3).join(' ');
      throw new GitError(`git ${args[0]} falló: ${detail}`, 'git', result);
    }
    return result;
  }

  private async out(args: string[]): Promise<string | null> {
    const r = await this.run(args, { allowFail: true });
    return r.code === 0 ? r.stdout.trim() || null : null;
  }

  async isRepo(): Promise<boolean> {
    return (await this.out(['rev-parse', '--is-inside-work-tree'])) === 'true';
  }

  async status(): Promise<RepoStatus> {
    const branch = await this.out(['symbolic-ref', '--short', 'HEAD']);
    const head = await this.out(['rev-parse', '--verify', '-q', 'HEAD']);
    const remotes = (await this.out(['remote'])) ?? '';
    const remote = remotes.split('\n').find((r) => r === 'origin') ?? remotes.split('\n')[0] ?? null;
    let ahead = 0;
    let behind = 0;
    const upstream = await this.out(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    if (upstream && head) {
      const counts = await this.out(['rev-list', '--left-right', '--count', `HEAD...${upstream}`]);
      if (counts) [ahead, behind] = counts.split(/\s+/).map(Number) as [number, number];
    }
    const label = upstream ?? (remote && branch ? `${remote}/${branch}` : (branch ?? 'sin rama'));
    return { branch, remote: remote || null, label, head, ahead, behind };
  }

  /**
   * Archivos de Aegon en un commit, en una sola llamada a `git cat-file --batch`. Las rutas son
   * relativas a la carpeta del workspace, que puede ser una subcarpeta del repo.
   */
  async readFiles(ref: string, include: (path: string) => boolean = isAegonFile): Promise<Map<string, string>> {
    const list = await this.run(['ls-tree', '-r', '-z', '--name-only', ref]);
    const paths = list.stdout.split('\0').filter((p) => p && include(p));
    const files = new Map<string, string>();
    if (!paths.length) return files;
    // `ref:./ruta` resuelve relativo al directorio actual (igual que el listado de ls-tree).
    const batch = await this.run(['cat-file', '--batch'], { input: paths.map((p) => `${ref}:./${p}`).join('\n') + '\n' });
    // El tamaño del header está en bytes: se parsea sobre los bytes UTF-8.
    const bytes = new TextEncoder().encode(batch.stdout);
    const decoder = new TextDecoder();
    let pos = 0;
    for (const path of paths) {
      const nl = bytes.indexOf(10, pos);
      if (nl < 0) break;
      const header = decoder.decode(bytes.subarray(pos, nl));
      const [, type, size] = header.split(' ');
      pos = nl + 1;
      if (type !== 'blob') continue;
      const length = Number(size);
      files.set(path, decoder.decode(bytes.subarray(pos, pos + length)).replace(/\r\n/g, '\n'));
      pos += length + 1;
    }
    return files;
  }

  private async modelAt(ref: string | null): Promise<{ model: Model; files: Map<string, string> }> {
    if (!ref) return { model: emptyModel('workspace', 'Workspace'), files: new Map() };
    const files = await this.readFiles(ref);
    return { model: parseWorkspace(files, { validate: false }).model, files };
  }

  private async remoteRef(st: RepoStatus): Promise<string | null> {
    if (!st.remote || !st.branch) return null;
    const upstream = await this.out(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    return upstream ?? `${st.remote}/${st.branch}`;
  }

  async prepare(local: { base: Model; synced: string | null; files?: ReadonlyMap<string, string> }): Promise<Prepared> {
    const st = await this.status();
    if (!st.remote) throw new GitError('El repo no tiene un remoto configurado (git remote add origin …)', 'no-remote');
    await this.run(['fetch', '--quiet', st.remote]);
    const ref = await this.remoteRef(st);
    const theirsHead = ref ? await this.out(['rev-parse', '--verify', '-q', `${ref}^{commit}`]) : null;
    const same = { upToDate: true, theirsHead, base: local.base, theirs: local.base, theirsFiles: new Map<string, string>() };
    if (!theirsHead || theirsHead === st.head) return same;
    if (st.head && (await this.run(['merge-base', '--is-ancestor', theirsHead, 'HEAD'], { allowFail: true })).code === 0) return same;
    const mergeBase = st.head ? await this.out(['merge-base', 'HEAD', theirsHead]) : null;
    const base = await this.modelAt(mergeBase);
    const theirs = await this.modelAt(theirsHead);
    return { upToDate: false, theirsHead, base: base.model, theirs: theirs.model, theirsFiles: theirs.files };
  }

  private async pathspecs(files: Iterable<string>): Promise<string[]> {
    const present = new Set<string>();
    for (const f of files) {
      const spec = AEGON_PATHSPECS.find((p) => f === p || f.startsWith(`${p}/`));
      if (spec) present.add(spec);
    }
    // También lo versionado que ya no existe en disco (borrados).
    const tracked = await this.out(['ls-files', '--', ...AEGON_PATHSPECS]);
    for (const f of tracked?.split('\n') ?? []) {
      const spec = AEGON_PATHSPECS.find((p) => f === p || f.startsWith(`${p}/`));
      if (spec) present.add(spec);
    }
    return [...present];
  }

  private async writeModel(model: Model): Promise<Map<string, string>> {
    const disk = await readAll(this.storage);
    const next = serializeWorkspace(model, { previous: disk });
    await applyWritePlan(this.storage, planWrite(disk, next));
    return next;
  }

  async publish(model: Model, message: string, prepared: Prepared): Promise<{ head: string | null; files: Map<string, string> }> {
    const st = await this.status();
    if (!st.branch) throw new GitError('El repo está en "detached HEAD": cambiá a una rama para publicar', 'detached');
    const next = await this.writeModel(model);
    const specs = await this.pathspecs(next.keys());
    if (specs.length) await this.run(['add', '-A', '--', ...specs]);
    const staged = (await this.run(['diff', '--cached', '--quiet'], { allowFail: true })).code === 1;
    if (staged) await this.run(['commit', '-q', '-m', message]);

    if (!prepared.upToDate && prepared.theirsHead) {
      // Git combina el resto del repo; los archivos del modelo se reemplazan por el merge semántico.
      const merge = await this.run(['merge', '--no-ff', '--no-commit', '-X', 'ours', prepared.theirsHead], { allowFail: true });
      const unmerged = ((await this.out(['diff', '--name-only', '--diff-filter=U'])) ?? '').split('\n').filter(Boolean);
      const foreign = unmerged.filter((p) => !isAegonFile(p));
      if (foreign.length || (merge.code !== 0 && !unmerged.length)) {
        await this.run(['merge', '--abort'], { allowFail: true });
        throw new GitError(
          foreign.length ? `Conflicto de git en archivos fuera del modelo: ${foreign.join(', ')}` : `git merge falló: ${merge.stderr.trim()}`,
          'merge-failed',
          merge,
        );
      }
      await this.writeModel(model);
      const specsAfter = await this.pathspecs((await readAll(this.storage)).keys());
      if (specsAfter.length) await this.run(['add', '-A', '--', ...specsAfter]);
      await this.run(['commit', '-q', '--no-edit', '-m', `Merge ${prepared.theirsHead.slice(0, 7)} (merge semántico de Aegon)`]);
    }

    const push = await this.run(['push', '--porcelain', '-u', st.remote ?? 'origin', `HEAD:${st.branch}`], { allowFail: true });
    if (push.code !== 0) {
      if (/rejected|non-fast-forward|fetch first/i.test(push.stderr + push.stdout)) throw new RemoteMovedError();
      throw new GitError(`git push falló: ${(push.stderr || push.stdout).trim().split('\n').slice(-2).join(' ')}`, 'push-failed', push);
    }
    return { head: await this.out(['rev-parse', 'HEAD']), files: await readAll(this.storage) };
  }

  async adopt(prepared: Prepared): Promise<{ head: string | null; files: Map<string, string> }> {
    if (prepared.upToDate || !prepared.theirsHead) {
      return { head: await this.out(['rev-parse', '--verify', '-q', 'HEAD']), files: await readAll(this.storage) };
    }
    const st = await this.status();
    if (st.head && (await this.run(['merge-base', '--is-ancestor', 'HEAD', prepared.theirsHead], { allowFail: true })).code !== 0) {
      throw new GitError('Tenés commits locales sin publicar: usá "Commit & push" para combinarlos con el remoto', 'diverged');
    }
    // Los cambios sin commitear del modelo ya están en el borrador de la app: se apartan del disco.
    const specs = await this.pathspecs((await readAll(this.storage)).keys());
    const dirty = specs.length ? ((await this.out(['status', '--porcelain', '--', ...specs])) ?? '') : '';
    let stashed = false;
    if (dirty) {
      await this.run(['stash', 'push', '--include-untracked', '-q', '-m', 'aegon: borrador antes de actualizar', '--', ...specs]);
      stashed = true;
    }
    const ff = await this.run(st.head ? ['merge', '--ff-only', '-q', prepared.theirsHead] : ['reset', '-q', '--hard', prepared.theirsHead], { allowFail: true });
    if (ff.code !== 0) {
      if (stashed) await this.run(['stash', 'pop', '-q'], { allowFail: true });
      throw new GitError(`No se pudo actualizar: ${(ff.stderr || ff.stdout).trim()}`, 'update-failed', ff);
    }
    if (stashed) await this.run(['stash', 'drop', '-q'], { allowFail: true });
    return { head: await this.out(['rev-parse', 'HEAD']), files: await readAll(this.storage) };
  }
}
