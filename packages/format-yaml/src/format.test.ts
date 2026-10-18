import { describe, expect, it } from 'vitest';
import { applyOp, deepEqual, demoModel, diffModels } from '@aegon/core';
import { sampleModel } from '../../core/src/test-fixtures.ts';
import { parseWorkspace } from './parse.ts';
import { planWrite, serializeWorkspace } from './serialize.ts';

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

  it('flujos y comentarios: un archivo cada uno y roundtrip exacto', () => {
    const model = demoModel();
    const files = serializeWorkspace(model);
    expect(files.has('flows/transferencia.yaml')).toBe(true);
    expect(files.has('comments/c-migrar-aurora.yaml')).toBe(true);
    expect(files.get('flows/transferencia.yaml')).toContain('- type: message\n    from: cliente\n    to: app-movil');
    const parsed = parseWorkspace(files);
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(diffModels(model, parsed.model)).toEqual([]);
    // Borrar el último comentario borra su archivo.
    const next = applyOp(parsed.model, { type: 'comment.remove', id: 'c-pasarela' }).model;
    expect(planWrite(files, serializeWorkspace(next, { previous: files })).deletes).toEqual(['comments/c-pasarela.yaml']);
  });
});
