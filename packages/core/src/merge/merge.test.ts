import { describe, expect, it } from 'vitest';
import { applyOp, applyOps, type Op } from '../ops/index.ts';
import { diffModels } from '../diff/index.ts';
import { sampleModel } from '../test-fixtures.ts';
import { applyResolutions, mergeModels } from './index.ts';

const edit = (ops: Op[]) => applyOps(sampleModel(), ops).model;

describe('mergeModels', () => {
  it('cambios en entidades distintas se combinan sin conflictos', () => {
    const base = sampleModel();
    const ours = edit([{ type: 'element.update', id: 'api', patch: { name: 'API v2' } }]);
    const theirs = edit([
      { type: 'element.add', element: { id: 'cache', kind: 'store', name: 'Cache', parent: 'banking', store: { engine: 'redis' } } },
      { type: 'element.update', id: 'web', patch: { risk: 'low' } },
    ]);
    const { merged, conflicts } = mergeModels(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(merged.elements.api!.name).toBe('API v2');
    expect(merged.elements.cache).toBeDefined();
    expect(merged.elements.web).toMatchObject({ risk: 'low' });
  });

  it('campos distintos de la misma entidad también se combinan', () => {
    const base = sampleModel();
    const ours = edit([{ type: 'element.update', id: 'api', patch: { name: 'API v2' } }]);
    const theirs = edit([{ type: 'element.update', id: 'api', patch: { risk: 'critical', technology: ['kotlin'] } }]);
    const { merged, conflicts } = mergeModels(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(merged.elements.api).toMatchObject({ name: 'API v2', risk: 'critical', technology: ['kotlin'] });
  });

  it('en un lienzo se mezcla nodo por nodo', () => {
    const base = sampleModel();
    const ours = edit([{ type: 'view.place', view: 'landscape', nodes: { banking: { x: 100, y: 100 } } }]);
    const theirs = edit([{ type: 'view.place', view: 'landscape', nodes: { core: { x: 900, y: 0 } } }]);
    const { merged, conflicts } = mergeModels(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(merged.views.landscape!.nodes.banking).toEqual({ x: 100, y: 100 });
    expect(merged.views.landscape!.nodes.core).toEqual({ x: 900, y: 0 });
  });

  it('el mismo campo cambiado distinto es conflicto; se resuelve por lado sin perder lo demás', () => {
    const base = sampleModel();
    const ours = edit([{ type: 'element.update', id: 'api', patch: { name: 'Nuestro', owner: 'equipo-a' } }]);
    const theirs = edit([{ type: 'element.update', id: 'api', patch: { name: 'De ellos', risk: 'low' } }]);
    const result = mergeModels(base, ours, theirs);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ key: 'element:api', kind: 'both-modified', fields: [{ path: ['name'], base: 'API', ours: 'Nuestro', theirs: 'De ellos' }] });
    expect(result.merged.elements.api).toMatchObject({ name: 'Nuestro', owner: 'equipo-a', risk: 'low' });

    const resolved = applyResolutions(result, ours, theirs, { 'element:api': 'theirs' }).model;
    expect(resolved.elements.api).toMatchObject({ name: 'De ellos', owner: 'equipo-a', risk: 'low' });
  });

  it('borrado de un lado y edición del otro es conflicto; elegir el borrado limpia referencias', () => {
    const base = sampleModel();
    const ours = edit([{ type: 'element.update', id: 'core-gw', patch: { name: 'Gateway 2' } }]);
    const theirs = edit([{ type: 'element.remove', id: 'core-gw' }]);
    const result = mergeModels(base, ours, theirs);
    expect(result.conflicts.map((c) => [c.key, c.kind])).toEqual([['element:core-gw', 'modified-deleted']]);
    expect(result.merged.elements['core-gw']!.name).toBe('Gateway 2');

    // La relación hacia core-gw ya se fue en el merge (del otro lado se borró en cascada).
    const { model } = applyResolutions(result, ours, theirs, { 'element:core-gw': 'theirs' });
    expect(model.elements['core-gw']).toBeUndefined();
    expect(model.relations['api--core-gw']).toBeUndefined();
    expect(Object.values(model.views).some((v) => v.nodes['core-gw'])).toBe(false);
  });

  it('repara relaciones que quedaron colgando y duplicadas para el mismo par', () => {
    const base = sampleModel();
    const ours = edit([{ type: 'relation.add', relation: { id: 'mine', from: 'customer', to: 'core' } }]);
    const theirs = applyOps(base, [
      { type: 'relation.add', relation: { id: 'yours', from: 'core', to: 'customer' } },
      { type: 'element.remove', id: 'db' },
    ]).model;
    const { merged, repairs } = mergeModels(base, ours, theirs);
    expect(merged.elements.db).toBeUndefined();
    expect(merged.relations['accounts--db']).toBeUndefined();
    expect(Object.keys(merged.relations).filter((r) => r === 'mine' || r === 'yours')).toEqual(['mine']);
    expect(repairs.some((r) => r.includes('yours'))).toBe(true);
  });

  it('merge de un lado sin cambios devuelve el otro', () => {
    const base = sampleModel();
    const theirs = applyOp(base, { type: 'element.remove', id: 'banking' }).model;
    const { merged, conflicts } = mergeModels(base, base, theirs);
    expect(conflicts).toEqual([]);
    expect(diffModels(theirs, merged)).toEqual([]);
  });
});
