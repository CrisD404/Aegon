import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { applyOp, demoModel } from '@aegon/core';
import { sampleModel } from '../../core/src/test-fixtures.ts';
import { FIXTURES, cleanupTemps, cli, modelOnDisk, tempCopy, tempWorkspace } from './testing.ts';

afterAll(cleanupTemps);

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

describe('aegon validate', () => {
  it('valida un workspace sano', async () => {
    const dir = tempWorkspace(sampleModel());
    const r = await cli(dir, 'validate');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Workspace "Demo"');
    expect(r.out).toContain('Sin errores ni avisos');
  });

  it('reporta errores con su archivo y sale con 1', async () => {
    const dir = tempWorkspace(sampleModel());
    writeFileSync(join(dir, 'model/relations/roto.yaml'), 'id: roto\nfrom: web\nto: fantasma\n');
    writeFileSync(join(dir, 'model/elements/mal.yaml'), 'id: mal\nkind: system\n');
    const r = await cli(dir, 'validate');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/model\/relations\/roto\.yaml .*fantasma.*\[missing-endpoint\]/);
    expect(r.out).toMatch(/model\/elements\/mal\.yaml .*name.*\[schema\]/);
    const json = JSON.parse((await cli(dir, 'validate', '--json')).out);
    expect(json.ok).toBe(false);
    expect(json.errors).toBe(2);
  });

  it('--strict hace fallar los avisos y --info suma los informativos', async () => {
    const model = applyOp(sampleModel(), { type: 'element.add', element: { id: 'suelto', kind: 'container', name: 'Suelto' } }).model;
    const dir = tempWorkspace(model);
    expect((await cli(dir, 'validate')).code).toBe(0);
    expect((await cli(dir, 'validate', '--strict')).code).toBe(1);
    expect((await cli(dir, 'validate', '--info')).out).toContain('[not-in-view]');
  });

  it('busca aegon.yaml hacia arriba y acepta --workspace antes del comando', async () => {
    const dir = tempWorkspace(sampleModel());
    expect((await cli(join(dir, 'model', 'elements'), 'validate')).code).toBe(0);
    expect((await cli(FIXTURES, '-w', dir, 'validate')).code).toBe(0);
  });

  it('funciona sobre el demo de fixtures/ (y se puede editar una copia)', async () => {
    const demo = await cli(FIXTURES, 'validate', '-w', 'demo', '--strict');
    expect(demo.code).toBe(0);
    expect(demo.out).toContain('Workspace "Banca digital (demo)" · 20 elementos · 18 relaciones · 3 lienzos');
    const copy = tempCopy('demo');
    expect((await cli(copy, 'add', 'container', 'Conciliador', '--view', 'home-banking-containers')).code).toBe(0);
    expect((await cli(copy, 'connect', 'conciliador', 'banking-db', '-p', 'jdbc')).code).toBe(0);
    expect((await cli(copy, 'validate', '--strict')).code).toBe(0);
  });

  it('explica cuando la carpeta no es un workspace', async () => {
    const r = await cli(join(FIXTURES, '..', 'docs'), 'validate', '-w', '.');
    expect(r.code).toBe(1);
    expect(r.err).toContain('no es un workspace de Aegon');
  });
});

describe('aegon lint', () => {
  it('suma el análisis: protocolos faltantes, hotspots y huérfanos', async () => {
    let model = sampleModel();
    model = applyOp(model, { type: 'element.add', element: { id: 'legacy', kind: 'system', name: 'Legacy' } }).model;
    const dir = tempWorkspace(model);
    const r = await cli(dir, 'lint');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Relaciones sin protocolo');
    expect(r.out).toContain('Cliente → Web (customer--web)');
    expect(r.out).toContain('Huérfanos');
    expect(r.out).toContain('Legacy (legacy, system)');
    expect(r.out).toContain('Hotspots de riesgo');
    expect(r.out).toContain('API (api): riesgo alto');
    expect((await cli(dir, 'lint', '--strict')).code).toBe(1);
    const json = JSON.parse((await cli(dir, 'lint', '--json')).out);
    expect(json.summary.orphans).toBe(1);
    expect(json.missingProtocols.map((m: { relation: string }) => m.relation)).toContain('accounts--db');
  });

  it('detecta ciclos de dependencias', async () => {
    const model = applyOp(sampleModel(), { type: 'relation.add', relation: { id: 'db--web', from: 'db', to: 'web' } }).model;
    const r = await cli(tempWorkspace(model), 'lint');
    expect(r.out).toContain('Ciclos de dependencias');
    expect(r.out).toContain('API → Banking DB → Web → API  [accounts--db, db--web, web--api]');
  });
});

describe('aegon add', () => {
  it('crea un container en un lienzo L2: hereda el sistema y queda ubicado', async () => {
    const dir = tempWorkspace(sampleModel());
    const r = await cli(dir, 'add', 'container', 'Pagos Batch', '--view', 'banking-containers', '-t', 'Java,spring-boot', '--container-type', 'worker', '-d', 'Conciliación');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Contenedor "Pagos Batch" agregado (pagos-batch) dentro de banking');
    const yaml = readFileSync(join(dir, 'model/elements/pagos-batch.yaml'), 'utf8');
    expect(yaml).toContain('parent: banking');
    expect(yaml).toContain('technology: [ java, spring-boot ]');
    const model = await modelOnDisk(dir);
    expect(model.views['banking-containers']!.nodes['pagos-batch']).toBeDefined();
    expect((await cli(dir, 'validate')).code).toBe(0);
  });

  it('resuelve motores, brokers y proveedores del catálogo', async () => {
    const dir = tempWorkspace(sampleModel());
    await cli(dir, 'add', 'store', 'Ledger', '--parent', 'Home Banking', '--engine', 'postgres');
    await cli(dir, 'add', 'bus', 'Eventos', '--parent', 'banking', '--broker', 'Apache Kafka', '--topics', 'pagos,cuentas');
    await cli(dir, 'add', 'group', 'GCP', '--provider', 'gcp', '--region', 'us-central1');
    const out = await cli(dir, 'add', 'db', 'Vieja', '--engine', 'informix', '--json');
    const model = await modelOnDisk(dir);
    expect(model.elements.ledger).toMatchObject({ kind: 'store', parent: 'banking', store: { engine: 'postgresql', type: 'relational' } });
    expect(model.elements.eventos).toMatchObject({ kind: 'bus', bus: { broker: 'kafka', type: 'stream', topics: ['pagos', 'cuentas'] } });
    expect(model.elements.gcp).toMatchObject({ kind: 'group', group: { provider: 'gcp', region: 'us-central1' } });
    expect(model.elements.vieja).toMatchObject({ store: { engine: 'other', customEngine: 'informix' } });
    expect(JSON.parse(out.out).warnings[0]).toContain('informix');
  });

  it('rechaza lo que viola las reglas C4 sin tocar el disco', async () => {
    const dir = tempWorkspace(sampleModel());
    const before = await modelOnDisk(dir);
    const bad = await cli(dir, 'add', 'component', 'Suelto', '--parent', 'banking');
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('Un component no puede estar dentro de un system [invalid-parent]');
    const placement = await cli(dir, 'add', 'component', 'Otro', '--parent', 'api', '--view', 'landscape');
    expect(placement.code).toBe(1);
    expect(placement.err).toContain('[invalid-placement]');
    expect(await modelOnDisk(dir)).toEqual(before);
  });

  it('valida los argumentos', async () => {
    const dir = tempWorkspace(sampleModel());
    expect((await cli(dir, 'add', 'container')).code).toBe(2);
    expect((await cli(dir, 'add', 'nave', 'X')).err).toContain('Tipo de elemento desconocido');
    expect((await cli(dir, 'add', 'system', 'X', '--risk', 'altisimo')).code).toBe(2);
    expect((await cli(dir, 'add', 'system', 'X', '--nope')).err).toContain('Opción desconocida --nope');
  });
});

describe('aegon connect', () => {
  it('crea, vuelve bidireccional y completa relaciones (una por par)', async () => {
    const dir = tempWorkspace(sampleModel());
    const created = await cli(dir, 'connect', 'Web', 'db', '-l', 'Lee', '-p', 'HTTPS,gRPC');
    expect(created.code).toBe(0);
    expect(created.out).toContain('Relación creada: Web → Banking DB (web--db)');
    let model = await modelOnDisk(dir);
    expect(model.relations['web--db']).toMatchObject({ label: 'Lee', protocols: ['https', 'grpc'] });

    const reverse = await cli(dir, 'connect', 'api', 'web');
    expect(reverse.out).toContain('bidireccional');
    model = await modelOnDisk(dir);
    expect(model.relations['web--api']!.direction).toBe('bidirectional');
    expect(Object.keys(model.relations).filter((id) => id.includes('api--web'))).toEqual([]);

    const again = await cli(dir, 'connect', 'customer', 'web', '-p', 'https');
    expect(again.out).toContain('Relación actualizada');
    expect((await modelOnDisk(dir)).relations['customer--web']!.protocols).toEqual(['https']);

    const same = await cli(dir, 'connect', 'customer', 'web');
    expect(same.out).toContain('Sin cambios');
  });

  it('sugiere protocolos según el destino y avisa los desconocidos', async () => {
    const dir = tempWorkspace(sampleModel());
    const r = await cli(dir, 'connect', 'web', 'db');
    expect(r.out).toMatch(/Sugeridos para "Banking DB": jdbc/);
    const unknown = await cli(dir, 'connect', 'customer', 'api', '-p', 'telepatia');
    expect(unknown.err).toContain('Protocolo "telepatia" fuera del catálogo');
  });

  it('no permite relaciones con grupos ni elementos inexistentes', async () => {
    const dir = tempWorkspace(sampleModel());
    expect((await cli(dir, 'connect', 'web', 'aws')).err).toContain('[invalid-endpoint]');
    expect((await cli(dir, 'connect', 'web', 'nadie')).err).toContain('No existe el elemento "nadie"');
  });
});

describe('aegon add (despliegue)', () => {
  it('nodos, infraestructura e instancias con direcciones, ambientes y puertos', async () => {
    const base = applyOp(sampleModel(), {
      type: 'batch',
      ops: [
        { type: 'workspace.update', patch: { environments: [{ id: 'qa', name: 'QA' }] } },
        { type: 'view.add', view: { id: 'despliegue', name: 'Despliegue', level: 'deployment', environment: 'qa', nodes: {} } },
      ],
    }).model;
    const dir = tempWorkspace(base);
    expect((await cli(dir, 'add', 'node', 'OCP', '--node-type', 'cluster', '--provider', 'openshift', '--size', 'm5.2xlarge', '--view', 'despliegue')).code).toBe(0);
    const inst = await cli(dir, 'add', 'instance', '--of', 'api', '--parent', 'ocp', '--env', 'qa', '--replicas', '3', '--view', 'despliegue');
    expect(inst.code).toBe(0);
    expect(inst.out).toContain('(api-qa)');
    expect((await cli(dir, 'add', 'infra', 'Egress', '--infra-type', 'egress', '--parent', 'ocp', '--addresses', '10.0.0.1,10.0.0.2', '--view', 'despliegue')).code).toBe(0);
    expect((await cli(dir, 'connect', 'api-qa', 'egress', '--ports', '443,:80', '-p', 'https')).code).toBe(0);
    expect((await cli(dir, 'add', 'instance')).code).toBe(2);
    expect((await cli(dir, 'layout', 'despliegue', '--fit-frames')).code).toBe(0);

    const model = await modelOnDisk(dir);
    expect(model.elements['api-qa']).toMatchObject({ kind: 'instance', name: 'API', parent: 'ocp', environments: ['qa'], instance: { of: 'api', replicas: 3 } });
    expect(model.elements.egress).toMatchObject({ infra: { type: 'egress' }, addresses: ['10.0.0.1', '10.0.0.2'] });
    expect(model.relations['api-qa--egress']).toMatchObject({ protocols: ['https'], ports: [443, 80] });
    const ocp = model.views.despliegue!.nodes.ocp!;
    const api = model.views.despliegue!.nodes['api-qa']!;
    expect(api.x).toBeGreaterThan(ocp.x);
    expect(api.y).toBeGreaterThan(ocp.y);
    expect((await cli(dir, 'validate')).code).toBe(0);
  });
});

describe('aegon layout', () => {
  it('ordena el lienzo por capas y reescribe solo su archivo', async () => {
    const dir = tempWorkspace(sampleModel());
    const r = await cli(dir, 'layout', 'banking-containers', '--json');
    const json = JSON.parse(r.out);
    expect(json.moved).toBeGreaterThan(0);
    expect(json.written).toEqual(['views/banking-containers.yaml']);
    const nodes = (await modelOnDisk(dir)).views['banking-containers']!.nodes;
    // web → api → db: cada uno en una capa más abajo.
    expect(nodes.web!.y).toBeLessThan(nodes.api!.y);
    expect(nodes.api!.y).toBeLessThan(nodes.db!.y);
    expect((await cli(dir, 'layout', 'banking-containers')).out).toContain('ya está ordenado');
    expect((await cli(dir, 'layout', 'nada')).code).toBe(1);
  });
});

describe('aegon diff', () => {
  it('muestra los cambios del modelo respecto de un commit', async () => {
    const dir = tempWorkspace(sampleModel(), { git: true });
    expect((await cli(dir, 'diff')).out).toContain('Sin cambios');
    await cli(dir, 'add', 'container', 'Batch', '--parent', 'banking');
    await cli(dir, 'connect', 'batch', 'db', '-p', 'jdbc');
    writeFileSync(join(dir, 'model/elements/api.yaml'), readFileSync(join(dir, 'model/elements/api.yaml'), 'utf8').replace('risk: high', 'risk: critical'));
    const r = await cli(dir, 'diff');
    expect(r.out).toContain('+ Agregar contenedor Batch');
    expect(r.out).toContain('+ Agregar relación Batch → Banking DB');
    expect(r.out).toContain('~ Actualizar contenedor API (risk)');
    expect(r.out).toContain('risk: "high" → "critical"');
    const json = JSON.parse((await cli(dir, 'diff', 'HEAD', '--json')).out);
    expect(json.changes).toHaveLength(3);
    expect((await cli(dir, 'diff', 'no-existe')).err).toContain('No existe la referencia "no-existe"');
  });

  it('funciona con el workspace en una subcarpeta del repo', async () => {
    const dir = tempWorkspace(sampleModel());
    const repo = join(dir, '..', `${dir.split(/[\\/]/).pop()}-repo`);
    execFileSync('git', ['init', '-q', repo]);
    const { cpSync } = await import('node:fs');
    cpSync(dir, join(repo, 'arquitectura'), { recursive: true });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
    git('add', '-A');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'x');
    await cli(join(repo, 'arquitectura'), 'add', 'system', 'Nuevo');
    const r = await cli(join(repo, 'arquitectura'), 'diff');
    expect(r.out.trim().split('\n')[0]).toBe('+ Agregar sistema Nuevo');
    const { rmSync } = await import('node:fs');
    rmSync(repo, { recursive: true, force: true });
  });
});

describe('aegon export', () => {
  it('exporta a los cuatro formatos', async () => {
    const dir = tempWorkspace(sampleModel());
    const mermaid = await cli(dir, 'export', 'mermaid', '--view', 'banking-containers');
    expect(mermaid.out).toContain('flowchart TB');
    expect(mermaid.out).toContain('subgraph banking["Home Banking · Sistema"]');
    expect(mermaid.out).toContain('web -->|"Llama<br/>[HTTPS]"| api');
    const all = await cli(dir, 'export', 'mermaid');
    expect(all.out).toContain('## Landscape');
    expect(all.out.match(/```mermaid/g)).toHaveLength(2);

    const puml = await cli(dir, 'export', 'plantuml-c4');
    expect(puml.out.match(/@startuml/g)).toHaveLength(2);
    expect(puml.out).toContain('System_Boundary(banking, "Home Banking")');
    expect(puml.out).toContain('ContainerDb(db, "Banking DB", "PostgreSQL"');
    expect(puml.out).toContain('Rel(customer, banking, "Usa", "", $tags="implicita")');

    const dsl = await cli(dir, 'export', 'structurizr');
    expect(dsl.out).toMatch(/^workspace "Demo"/);
    expect(dsl.out).toContain('container banking "banking-containers"');
    expect(dsl.out).toContain('group "AWS us-east-1" {');

    const json = JSON.parse((await cli(dir, 'export', 'json')).out);
    expect(json.elements.map((e: { id: string }) => e.id)).toContain('accounts');
  });

  it('escribe en un archivo con --output y valida el formato', async () => {
    const dir = tempWorkspace(sampleModel());
    const r = await cli(dir, 'export', 'dsl', '-o', 'out/arquitectura.dsl');
    expect(r.code).toBe(0);
    expect(readFileSync(join(dir, 'out/arquitectura.dsl'), 'utf8')).toContain('views {');
    expect((await cli(dir, 'export', 'svg')).code).toBe(2);
  });
});

describe('aegon flows y flow', () => {
  it('lista los flujos y muestra uno con sus pasos numerados', async () => {
    const dir = tempWorkspace(demoModel());
    const list = await cli(dir, 'flows');
    expect(list.code).toBe(0);
    expect(list.out).toBe('transferencia  Transferencia desde la app (7 pasos · lienzo home-banking-containers)\n');
    expect(JSON.parse((await cli(dir, 'flows', '--json')).out).flows[0]).toMatchObject({ id: 'transferencia', steps: 7 });
    expect((await cli(dir, 'flows', '--element', 'Motor antifraude')).out).toContain('transferencia');
    expect((await cli(dir, 'flows', '--element', 'cuentas-api')).out).toBe('Ningún flujo pasa por ese elemento\n');
    expect((await cli(tempWorkspace(sampleModel()), 'flows')).out).toContain('Sin flujos');

    const flow = await cli(dir, 'flow', 'Transferencia desde la app');
    expect(flow.code).toBe(0);
    expect(flow.out).toMatch(/^Transferencia desde la app\n/);
    expect(flow.out).toContain('\n1. Cliente → App móvil: Confirma la transferencia\n');
    expect(flow.out).toContain('   A) Aprobada\n      5A.1. Transfer Controller → Core Client: Debita la cuenta origen\n');
    expect(flow.out).toContain('\n7. Fin\n   El cliente recibe un push con el resultado.\n');
    const json = JSON.parse((await cli(dir, 'flow', 'transferencia', '--json')).out);
    expect(json.file).toBe('flows/transferencia.yaml');
    expect(json.steps[4].paths[1]).toMatchObject({ letter: 'B', name: 'Rechazada por riesgo', steps: [{ n: '5B.1', relation: 'pagos-api--eventos' }] });

    const missing = await cli(dir, 'flow', 'nada');
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('No existe el flujo "nada"');
    expect((await cli(dir, 'flow')).code).toBe(2);
  });

  it('muestra los avisos de un flujo con pasos rotos', async () => {
    const model = applyOp(demoModel(), { type: 'element.remove', id: 'fraude' }).model;
    const r = await cli(tempWorkspace(model), 'flow', 'transferencia');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Paso 4 de "Transferencia desde la app": "fraude" no existe [flow-missing-element]');
  });

  it('export flow: diagrama de secuencia de Mermaid o texto', async () => {
    const dir = tempWorkspace(demoModel());
    const mermaid = await cli(dir, 'export', 'flow', 'transferencia', 'mermaid');
    expect(mermaid.code).toBe(0);
    expect(mermaid.out).toMatch(/^sequenceDiagram\n {2}title Transferencia desde la app\n/);
    expect(mermaid.out).toContain('  alt Aprobada\n');
    expect(mermaid.out).toContain('  else Rechazada por riesgo\n');

    const text = await cli(dir, 'export', 'flow', 'Transferencia desde la app', 'text', '-o', 'docs/transferencia.txt');
    expect(text.code).toBe(0);
    expect(readFileSync(join(dir, 'docs/transferencia.txt'), 'utf8')).toContain('5B.1. Pagos API → Eventos de pagos: Publica pagos.rechazados');

    expect((await cli(dir, 'export', 'flow', 'transferencia', 'svg')).err).toContain('Formato de flujo desconocido "svg"');
    expect((await cli(dir, 'export', 'flow', 'transferencia')).code).toBe(2);
    expect((await cli(dir, 'export', 'flow', 'nada', 'text')).code).toBe(1);
  });
});

describe('aegon comments', () => {
  it('lista los comentarios con sus respuestas y filtra los abiertos', async () => {
    const dir = tempWorkspace(applyOp(demoModel(), { type: 'comment.update', id: 'c-pasarela', patch: { resolved: true } }).model);
    const all = await cli(dir, 'comments');
    expect(all.code).toBe(0);
    expect(all.out).toContain(
      '○ c-migrar-aurora  Home Banking · Contenedores › Banking DB\n' +
        '  Arquitectura, 2026-10-15: ¿Migramos a Aurora Serverless? En producción ya pasa los USD 1.800 por mes.\n' +
        '    ↳ Equipo Canales, 2026-10-16: Lo evaluamos el próximo trimestre; primero hay que medir los IOPS.\n',
    );
    expect(all.out).toContain('✓ c-pasarela  Landscape\n  Dependencia crítica\n');
    expect(all.out).toMatch(/2 comentarios · 1 abierto · 1 resuelto\n$/);

    const open = await cli(dir, 'comments', '--open');
    expect(open.out).not.toContain('c-pasarela');
    expect(open.out).toMatch(/1 comentario · 1 abierto · 0 resueltos\n$/);
    expect(JSON.parse((await cli(dir, 'comments', '--resolved', '--json')).out)).toMatchObject({ total: 1, open: 0, resolved: 1, comments: [{ id: 'c-pasarela', resolved: true }] });
    expect(JSON.parse((await cli(dir, 'comments', '--view', 'home-banking-containers', '--json')).out).comments.map((c: { id: string }) => c.id)).toEqual(['c-migrar-aurora']);
    expect(JSON.parse((await cli(dir, 'comments', '--element', 'Banking DB', '--json')).out).total).toBe(1);
    expect((await cli(dir, 'comments', '--open', '--resolved')).code).toBe(2);
    expect((await cli(tempWorkspace(sampleModel()), 'comments')).out).toBe('0 comentarios · 0 abiertos · 0 resueltos\n');
  });
});

describe('aegon init', () => {
  it('crea un workspace vacío o el demo', async () => {
    const base = tempWorkspace(sampleModel());
    const empty = await cli(base, 'init', 'nuevo', '--name', 'Pagos');
    expect(empty.code).toBe(0);
    const model = await modelOnDisk(join(base, 'nuevo'));
    expect(model.workspace).toMatchObject({ id: 'pagos', name: 'Pagos', defaultView: 'contexto' });
    expect(existsSync(join(base, 'nuevo', 'AGENTS.md'))).toBe(true);

    expect((await cli(base, 'init', 'demo', '--demo')).code).toBe(0);
    expect((await cli(join(base, 'demo'), 'validate')).out).toContain('Sin errores');

    expect((await cli(base, 'init', 'nuevo')).err).toContain('ya es un workspace');
  });

  it('en una carpeta con archivos respeta lo que ya hay', async () => {
    const base = tempWorkspace(sampleModel());
    const repo = join(base, 'repo');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(repo);
    writeFileSync(join(repo, 'README.md'), '# Mi repo\n');
    writeFileSync(join(repo, '.gitignore'), 'node_modules/\n');
    expect((await cli(repo, 'init')).code).toBe(0);
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('# Mi repo\n');
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toBe('node_modules/\n\n# Aegon: estado local de borrador y recuperación (no se versiona)\n.aegon/\n');
  });
});

describe('binario', () => {
  it('corre con Node sin compilar (type stripping)', () => {
    const dir = tempWorkspace(sampleModel());
    const ok = spawnSync(process.execPath, [MAIN, 'validate', '-w', dir], { encoding: 'utf8' });
    expect(ok.stderr).toBe('');
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('Sin errores');
    const help = spawnSync(process.execPath, [MAIN], { encoding: 'utf8' });
    expect(help.stdout).toContain('Uso: aegon <comando>');
    expect(spawnSync(process.execPath, [MAIN, 'nope'], { encoding: 'utf8' }).status).toBe(2);
  });
});
