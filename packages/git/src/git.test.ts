import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyOp, mergeModels, applyResolutions, type Model, type Op } from '@aegon/core';
import { parseWorkspace, serializeWorkspace } from '@aegon/format-yaml';
import { readAll } from '@aegon/storage';
import { NodeFsStorage } from '@aegon/storage/node';
import { sampleModel } from '../../core/src/test-fixtures.ts';
import { CliGitSync } from './cli.ts';
import { GitHubSync } from './github.ts';
import { NodeGitBackend } from './node.ts';
import { FakeGitHub } from './testing/fake-github.ts';
import type { GitSync } from './types.ts';

/** Una "persona" con su clon: replica lo que hace la app (base, borrador, commit sincronizado). */
class Person {
  base!: Model;
  current!: Model;
  files = new Map<string, string>();
  synced: string | null = null;
  readonly sync: GitSync;
  readonly storage?: NodeFsStorage;
  constructor(sync: GitSync, storage?: NodeFsStorage) {
    this.sync = sync;
    this.storage = storage;
  }

  async load() {
    this.files = this.storage ? await readAll(this.storage) : this.files;
    this.base = parseWorkspace(this.files).model;
    this.current = this.base;
    this.synced = (await this.sync.status()).head;
  }

  edit(op: Op) {
    this.current = applyOp(this.current, op).model;
  }

  /** Commit & push con merge semántico; devuelve los conflictos si los hay. */
  async push(message: string, choices?: Record<string, 'ours' | 'theirs'>) {
    const prepared = await this.sync.prepare({ base: this.base, synced: this.synced });
    let final = this.current;
    if (!prepared.upToDate) {
      const result = mergeModels(prepared.base, this.current, prepared.theirs);
      if (result.conflicts.length && !choices) return { conflicts: result.conflicts };
      final = choices ? applyResolutions(result, this.current, prepared.theirs, choices).model : result.merged;
    }
    const { head, files } = await this.sync.publish(final, message, prepared, this.files);
    this.base = this.current = final;
    this.files = files;
    this.synced = head;
    return { conflicts: [] };
  }

  async pull() {
    const prepared = await this.sync.prepare({ base: this.base, synced: this.synced });
    if (prepared.upToDate) return { conflicts: [] };
    const result = mergeModels(this.base, this.current, prepared.theirs);
    const { head, files } = await this.sync.adopt(prepared);
    this.files = files;
    this.base = prepared.theirs;
    this.current = result.merged;
    this.synced = head;
    return { conflicts: result.conflicts };
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'aegon-git-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function git(cwd: string, ...args: string[]) {
  const r = await new NodeGitBackend(cwd).run(args);
  if (r.code !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

async function setupRepo(name: string, remote: string) {
  const dir = join(tmp, name);
  await git(tmp, 'clone', '-q', remote, dir);
  await git(dir, 'config', 'user.name', name);
  await git(dir, 'config', 'user.email', `${name}@aegon.test`);
  await git(dir, 'config', 'core.autocrlf', 'false');
  return dir;
}

describe('CliGitSync (git real)', () => {
  let ana: Person;
  let beto: Person;
  let anaDir: string;
  let betoDir: string;

  beforeAll(async () => {
    const remote = join(tmp, 'remote.git');
    await git(tmp, 'init', '-q', '--bare', '-b', 'main', remote);
    anaDir = await setupRepo('ana', remote);
    // Ana inicia el workspace y lo publica.
    const storage = new NodeFsStorage(anaDir);
    for (const [p, c] of serializeWorkspace(sampleModel())) await storage.write(p, c);
    writeFileSync(join(anaDir, 'README.md'), '# Arquitectura\n');
    await git(anaDir, 'checkout', '-q', '-b', 'main');
    await git(anaDir, 'add', '.');
    await git(anaDir, 'commit', '-q', '-m', 'inicio');
    await git(anaDir, 'push', '-q', '-u', 'origin', 'main');
    ana = new Person(new CliGitSync(new NodeGitBackend(anaDir), storage), storage);
    await ana.load();
    betoDir = await setupRepo('beto', remote);
    const betoStorage = new NodeFsStorage(betoDir);
    beto = new Person(new CliGitSync(new NodeGitBackend(betoDir), betoStorage), betoStorage);
    await beto.load();
  }, 60_000);

  it('status informa rama y remoto', async () => {
    const st = await ana.sync.status();
    expect(st).toMatchObject({ branch: 'main', remote: 'origin', ahead: 0, behind: 0 });
    expect(st.label).toBe('origin/main');
  });

  it('publica un cambio (commit + push) sin tocar archivos ajenos', async () => {
    ana.edit({ type: 'element.update', id: 'api', patch: { name: 'API Core' } });
    await ana.push('Renombrar API');
    expect(await git(anaDir, 'log', '-1', '--format=%s')).toBe('Renombrar API');
    expect(await git(anaDir, 'status', '--porcelain')).toBe('');
    expect(readFileSync(join(anaDir, 'model/elements/api.yaml'), 'utf8')).toContain('name: API Core');
  });

  it('combina cambios de dos personas en entidades distintas (merge semántico + git)', async () => {
    // Beto no tiene el cambio de Ana: edita otra cosa y además alguien cambió el README.
    beto.edit({ type: 'element.update', id: 'web', patch: { risk: 'low' } });
    writeFileSync(join(anaDir, 'README.md'), '# Arquitectura\n\nActualizado por Ana.\n');
    await git(anaDir, 'commit', '-q', '-am', 'README');
    await git(anaDir, 'push', '-q');
    ana.synced = await git(anaDir, 'rev-parse', 'HEAD');

    const { conflicts } = await beto.push('Riesgo de la web');
    expect(conflicts).toEqual([]);
    expect(beto.current.elements.api!.name).toBe('API Core');
    expect(beto.current.elements.web).toMatchObject({ risk: 'low' });
    expect(readFileSync(join(betoDir, 'README.md'), 'utf8')).toContain('Actualizado por Ana');
    expect(await git(betoDir, 'status', '--porcelain')).toBe('');
    // Merge commit con ambos padres.
    expect((await git(betoDir, 'log', '-1', '--format=%p')).split(' ')).toHaveLength(2);
  });

  it('pull trae lo remoto y conserva el borrador local', async () => {
    ana.edit({ type: 'element.update', id: 'db', patch: { description: 'Borrador de Ana' } });
    const { conflicts } = await ana.pull();
    expect(conflicts).toEqual([]);
    expect(ana.base.elements.web).toMatchObject({ risk: 'low' });
    expect(ana.current.elements.db!.description).toBe('Borrador de Ana');
    expect(ana.synced).toBe(await git(betoDir, 'rev-parse', 'HEAD'));
  });

  it('detecta conflictos en el mismo campo y publica la resolución elegida', async () => {
    await ana.push('Descripción de la DB');
    await beto.pull();
    ana.edit({ type: 'element.update', id: 'customer', patch: { name: 'Cliente minorista' } });
    await ana.push('Cliente minorista');
    beto.edit({ type: 'element.update', id: 'customer', patch: { name: 'Cliente empresa' } });

    const first = await beto.push('Cliente empresa');
    expect(first.conflicts.map((c) => c.key)).toEqual(['element:customer']);
    await beto.push('Cliente empresa', { 'element:customer': 'theirs' });
    expect(beto.current.elements.customer!.name).toBe('Cliente minorista');
    expect(readFileSync(join(betoDir, 'model/elements/customer.yaml'), 'utf8')).toContain('Cliente minorista');
  });
});

describe('GitHubSync (API simulada)', () => {
  it('lee, publica, detecta que el remoto avanzó y combina', async () => {
    const gh = new FakeGitHub();
    const initial = serializeWorkspace(sampleModel());
    gh.pushFiles('main', new Map([...initial, ['README.md', '# hola']]), 'inicio');
    const sync = () => new GitHubSync({ owner: 'acme', repo: 'arquitectura', branch: 'main', token: 't' }, gh.fetch);

    const ana = new Person(sync());
    ana.files = await (ana.sync as GitHubSync).readFiles((await ana.sync.status()).head!);
    await ana.load();
    expect(Object.keys(ana.base.elements)).toContain('api');

    // Alguien cambia el remoto mientras Ana edita.
    const remote = parseWorkspace(gh.filesAt('main')).model;
    const edited = applyOp(remote, { type: 'element.update', id: 'web', patch: { owner: 'equipo-web' } }).model;
    gh.pushFiles('main', serializeWorkspace(edited, { previous: gh.filesAt('main') }), 'otro');

    ana.edit({ type: 'element.update', id: 'api', patch: { risk: 'low' } });
    const { conflicts } = await ana.push('Riesgo bajo');
    expect(conflicts).toEqual([]);
    const final = parseWorkspace(gh.filesAt('main')).model;
    expect(final.elements.api).toMatchObject({ risk: 'low' });
    expect(final.elements.web).toMatchObject({ owner: 'equipo-web' });
    expect(gh.filesAt('main').get('README.md')).toBe('# hola');
  });
});

describe('gitBlobSha', () => {
  it('coincide con el hash de git (git hash-object)', async () => {
    const { gitBlobSha } = await import('./github.ts');
    expect(await gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });
});
