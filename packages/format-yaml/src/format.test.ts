import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyOp, deepEqual, diffModels, validateModel } from '@aegon/core';
import { sampleModel } from '../../core/src/test-fixtures.ts';
import { importC4Pro, isC4ProWorkspace } from './import-c4pro.ts';
import { parseWorkspace } from './parse.ts';
import { planWrite, serializeWorkspace } from './serialize.ts';

function readDir(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(relative(root, full).replace(/\\/g, '/'), readFileSync(full, 'utf8'));
    }
  };
  walk(root);
  return out;
}

const C4PRO = fileURLToPath(new URL('../../../fixtures/c4pro', import.meta.url));

describe('serialize / parse', () => {
  it('roundtrip: parse(serialize(model)) == model', () => {
    const model = sampleModel();
    const files = serializeWorkspace(model);
    const { model: parsed, diagnostics } = parseWorkspace(files);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(diffModels(model, parsed)).toEqual([]);
    expect(deepEqual(parsed, model)).toBe(true);
  });

  it('es determinista y estable (serializar dos veces da lo mismo)', () => {
    const model = sampleModel();
    const a = serializeWorkspace(model);
    const b = serializeWorkspace(parseWorkspace(a).model, { previous: a });
    expect([...b]).toEqual([...a]);
  });

  it('usa rutas por entidad, orden de claves fijo y estilo compacto', () => {
    const files = serializeWorkspace(sampleModel());
    expect([...files.keys()]).toEqual(expect.arrayContaining([
      'aegon.yaml', 'AGENTS.md', '.gitignore', 'model/elements/api.yaml', 'model/relations/web--api.yaml', 'views/landscape.yaml',
    ]));
    expect(files.get('model/elements/api.yaml')).toBe(
      'id: api\nkind: container\nname: API\nparent: banking\nrisk: high\ntechnology: [ java ]\n',
    );
    expect(files.get('views/banking-containers.yaml')).toContain('nodes:\n  api: { x: 320, y: 0 }\n');
    expect(files.get('model/elements/db.yaml')).toContain('store:\n  engine: postgresql\n  type: relational\n');
  });

  it('conserva comentarios en archivos sin cambios y la cabecera en los modificados', () => {
    const model = sampleModel();
    const files = serializeWorkspace(model);
    const edited = new Map(files);
    edited.set('model/elements/api.yaml', `# Owner: equipo pagos\n${files.get('model/elements/api.yaml')}`);
    edited.set('model/elements/web.yaml', `${files.get('model/elements/web.yaml')}# nota al pie\n`);

    const next = applyOp(parseWorkspace(edited).model, { type: 'element.update', id: 'api', patch: { name: 'API Core' } }).model;
    const out = serializeWorkspace(next, { previous: edited });
    expect(out.get('model/elements/web.yaml')).toBe(edited.get('model/elements/web.yaml'));
    expect(out.get('model/elements/api.yaml')).toMatch(/^# Owner: equipo pagos\nid: api\n/);
    expect(out.get('model/elements/api.yaml')).toContain('name: API Core');
  });

  it('planWrite escribe solo lo que cambió y nunca borra archivos ajenos', () => {
    const model = sampleModel();
    const previous = new Map(serializeWorkspace(model));
    previous.set('README.md', '# repo');
    const next = applyOp(model, { type: 'element.remove', id: 'db' }).model;
    const plan = planWrite(previous, serializeWorkspace(next, { previous }));
    expect(plan.deletes).toEqual(['model/elements/db.yaml', 'model/relations/accounts--db.yaml']);
    expect([...plan.writes.keys()]).toEqual(['views/banking-containers.yaml']);
  });

  it('reporta errores de sintaxis y esquema sin abortar la carga', () => {
    const files = new Map(serializeWorkspace(sampleModel()));
    files.set('model/elements/broken.yaml', 'id: broken\nkind: [oops');
    files.set('model/elements/bad.yaml', 'id: bad\nkind: spaceship\nname: X\n');
    const { model, diagnostics } = parseWorkspace(files);
    expect(model.elements.api).toBeDefined();
    expect(diagnostics.map((d) => [d.code, d.file])).toEqual(
      expect.arrayContaining([
        ['yaml-syntax', 'model/elements/broken.yaml'],
        ['schema', 'model/elements/bad.yaml'],
      ]),
    );
  });
});

describe('importC4Pro', () => {
  const files = readDir(C4PRO);
  const { model, diagnostics } = importC4Pro(files);

  it('detecta el formato', () => {
    expect(isC4ProWorkspace(files)).toBe(true);
    expect(isC4ProWorkspace(serializeWorkspace(sampleModel()))).toBe(false);
  });

  it('importa elementos, relaciones y vistas', () => {
    expect(Object.keys(model.elements)).toHaveLength(15);
    expect(Object.keys(model.relations).length).toBeGreaterThan(0);
    expect(Object.keys(model.views)).toHaveLength(6);
    expect(model.workspace).toMatchObject({ name: 'Repo workspace', organization: 'AcmeCorp', architect: 'Cristian', defaultView: 'root-landscape' });
    expect((model.workspace.extensions?.c4pro as Record<string, unknown>).environments).toHaveLength(4);
  });

  it('mapea tipos y metadatos', () => {
    expect(model.elements.pG4QIZFoaaAp).toMatchObject({ kind: 'container', name: 'hola', technology: ['nginx'] });
    expect(model.elements.I0A5OsAkf3hC).toMatchObject({ kind: 'system', risk: 'high', technology: ['php'], description: 'x..D', docs: 'ysi, es php' });
    expect(model.elements.TUtPCM29ig3w).toMatchObject({ status: 'planned', scope: 'external', risk: 'medium' });
    expect(model.elements.t6mLIbWamAaZ).toMatchObject({ kind: 'group', group: { provider: 'aws' } });
    expect(model.elements['45iLba4D_Xsc']!.extensions?.c4pro).toMatchObject({ cost: { replicas: 1 }, finopsTags: { owner: 'ypp' } });
  });

  it('infiere la jerarquía desde las vistas L2/L3', () => {
    expect(model.elements.pG4QIZFoaaAp!.parent).toBe('TUtPCM29ig3w');
    expect(model.elements['4qAw-ZPvCqO7']!.parent).toBe('pG4QIZFoaaAp');
    expect(model.views.FDWN2u4rfbV4).toMatchObject({ level: 2, scope: 'TUtPCM29ig3w' });
  });

  it('infiere membresía a grupos por contención visual', () => {
    // "Sistema php dealgo" está dibujado dentro de "AWS - North Virginia" en el landscape.
    expect(model.elements.I0A5OsAkf3hC!.groups).toEqual(['6Tcp0Lzw2i1-']);
  });

  it('conserva adjuntos y produce un modelo válido y serializable', () => {
    expect(Object.keys(model.passthrough ?? {})).toEqual(expect.arrayContaining(['attachments/adr/4kYdRzCnG-Rz.yaml', 'attachments/workspace-logo.svg']));
    expect(validateModel(model).filter((d) => d.severity === 'error')).toEqual([]);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const reparsed = parseWorkspace(serializeWorkspace(model)).model;
    expect(diffModels(model, reparsed)).toEqual([]);
  });
});
